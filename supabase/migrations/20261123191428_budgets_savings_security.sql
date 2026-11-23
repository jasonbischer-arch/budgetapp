-- Automatic budgets, fixed vs variable expenses, savings per paycheck, and
-- tighter household joining.

-- ---------------------------------------------------------------------------
-- Fixed vs variable expenses
-- ---------------------------------------------------------------------------
alter table public.categories
  add column expense_type text not null default 'variable'
    check (expense_type in ('fixed', 'variable')),
  -- true: the budget follows your 12-month average automatically.
  add column budget_auto boolean not null default false;

-- Fixed: rent, utilities, insurance, subscriptions/services, education,
-- taxes, loan payments. Everything else (groceries, dining, shopping...) is
-- variable.
create or replace function public.default_expense_type(p text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p && '{RENT_AND_UTILITIES_RENT,RENT_AND_UTILITIES,GENERAL_SERVICES_INSURANCE,GENERAL_SERVICES_EDUCATION,GENERAL_SERVICES,GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT,LOAN_PAYMENTS}'::text[]
      then 'fixed'
    else 'variable'
  end;
$$;

update public.categories
set expense_type = public.default_expense_type(provider_categories)
where kind = 'expense';

create or replace function public.categories_set_expense_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'expense' and tg_op = 'INSERT' then
    new.expense_type := public.default_expense_type(new.provider_categories);
  end if;
  return new;
end;
$$;

create trigger categories_set_expense_type
before insert on public.categories
for each row execute function public.categories_set_expense_type();

-- ---------------------------------------------------------------------------
-- Automatic budgets: average monthly spending over the last 12 complete
-- months (or as many as the bank history covers), rounded up to $10.
-- Only variable categories, and only where you haven't set a budget yourself.
-- Runs with the caller's permissions, so a member only updates their own
-- household; the service role updates every household.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_auto_budgets()
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  with bounds as (
    select
      household_id,
      greatest(
        date_trunc('month', now() - interval '12 months')::date,
        case when extract(day from min(date)) <= 3
          then date_trunc('month', min(date))::date
          else (date_trunc('month', min(date)) + interval '1 month')::date
        end
      ) as first_month,
      date_trunc('month', now())::date as this_month
    from public.transactions
    group by household_id
  ),
  months as (
    select
      household_id,
      first_month,
      this_month,
      ((extract(year from this_month) - extract(year from first_month)) * 12
        + extract(month from this_month) - extract(month from first_month))::int as n
    from bounds
  ),
  spend as (
    select f.household_id, f.category_id, sum(-f.amount) as total, m.n
    from public.transaction_flows f
    join months m on m.household_id = f.household_id
    where f.flow in ('spending', 'refund')
      and f.category_id is not null
      and f.month >= m.first_month
      and f.month < m.this_month
      and m.n > 0
    group by f.household_id, f.category_id, m.n
  )
  update public.categories c
  set monthly_budget = ceil(s.total / s.n / 10) * 10,
      budget_auto = true
  from spend s
  where c.id = s.category_id
    and c.kind = 'expense'
    and c.expense_type = 'variable'
    and (c.budget_auto or c.monthly_budget is null)
    and s.total > 0
    and c.monthly_budget is distinct from ceil(s.total / s.n / 10) * 10;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.refresh_auto_budgets() from public, anon;
grant execute on function public.refresh_auto_budgets() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Savings per paycheck (null = calculated automatically by the app)
-- ---------------------------------------------------------------------------
alter table public.households
  add column savings_per_check numeric(12, 2) check (savings_per_check >= 0),
  -- A household is just the two of you unless raised.
  add column max_members int not null default 2 check (max_members between 1 and 10);

grant update (name, savings_per_check) on public.households to authenticated;

-- ---------------------------------------------------------------------------
-- Safer joining: limited attempts, full households closed, rotatable codes
-- ---------------------------------------------------------------------------
create table public.join_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index join_attempts_user on public.join_attempts (user_id, attempted_at);
alter table public.join_attempts enable row level security; -- no policies
revoke all on public.join_attempts from anon, authenticated;

-- Returns the household id, or null if the code didn't match (the failed
-- attempt is recorded; 5 failures an hour locks joining for that hour).
create or replace function public.join_household(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  full_house boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'You already belong to a household';
  end if;
  if (select count(*) from public.join_attempts
      where user_id = auth.uid() and attempted_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many attempts. Try again in an hour.';
  end if;

  select id into hid from public.households where invite_code = upper(trim(code));
  if hid is null then
    insert into public.join_attempts (user_id) values (auth.uid());
    return null;
  end if;

  select count(*) >= h.max_members into full_house
  from public.households h
  join public.household_members m on m.household_id = h.id
  where h.id = hid
  group by h.max_members;
  if full_house then
    raise exception 'This household is full';
  end if;

  insert into public.household_members (household_id, user_id, role) values (hid, auth.uid(), 'member');
  return hid;
end;
$$;

revoke all on function public.join_household(text) from public, anon;
grant execute on function public.join_household(text) to authenticated;

-- A member can replace the invite code (e.g. if it was shared by mistake).
create or replace function public.rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  new_code text;
begin
  select household_id into hid from public.household_members where user_id = auth.uid();
  if hid is null then
    raise exception 'Not in a household';
  end if;
  new_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
  update public.households set invite_code = new_code where id = hid;
  return new_code;
end;
$$;

revoke all on function public.rotate_invite_code() from public, anon;
grant execute on function public.rotate_invite_code() to authenticated;

-- New invite codes are 10 characters (about a trillion possibilities).
alter table public.households
  alter column invite_code set default upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
