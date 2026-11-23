-- Money flows, savings transfers, income schedules, bills & debts.

-- ---------------------------------------------------------------------------
-- 1. Category kinds. Savings/investment transfers get their own category so
--    they count as "moved to savings", never as spending.
-- ---------------------------------------------------------------------------
alter table public.categories
  add column kind text not null default 'expense'
  check (kind in ('income', 'expense', 'transfer', 'savings'));

update public.categories set kind = 'income' where is_income;
update public.categories set kind = 'transfer' where name = 'Transfers';

insert into public.categories (household_id, name, color, kind, provider_categories, sort_order)
select id, 'Savings & Investing', '#0D9488', 'savings',
       '{TRANSFER_OUT_SAVINGS,TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS}', 17
from public.households
on conflict (household_id, name) do nothing;

create or replace function public.seed_default_categories(hid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (household_id, name, color, kind, is_income, provider_categories, sort_order) values
    (hid, 'Income',              '#16A34A', 'income',  true,  '{INCOME}', 0),
    (hid, 'Groceries',           '#22C55E', 'expense', false, '{FOOD_AND_DRINK_GROCERIES}', 1),
    (hid, 'Dining & Drinks',     '#F97316', 'expense', false, '{FOOD_AND_DRINK}', 2),
    (hid, 'Rent & Home',         '#0EA5E9', 'expense', false, '{RENT_AND_UTILITIES_RENT,HOME_IMPROVEMENT}', 3),
    (hid, 'Utilities & Phone',   '#6366F1', 'expense', false, '{RENT_AND_UTILITIES}', 4),
    (hid, 'Transportation',      '#EAB308', 'expense', false, '{TRANSPORTATION}', 5),
    (hid, 'Travel',              '#06B6D4', 'expense', false, '{TRAVEL}', 6),
    (hid, 'Shopping',            '#EC4899', 'expense', false, '{GENERAL_MERCHANDISE}', 7),
    (hid, 'Entertainment',       '#A855F7', 'expense', false, '{ENTERTAINMENT}', 8),
    (hid, 'Health',              '#EF4444', 'expense', false, '{MEDICAL}', 9),
    (hid, 'Personal Care',       '#F472B6', 'expense', false, '{PERSONAL_CARE}', 10),
    (hid, 'Insurance',           '#64748B', 'expense', false, '{GENERAL_SERVICES_INSURANCE}', 11),
    (hid, 'Education',           '#14B8A6', 'expense', false, '{GENERAL_SERVICES_EDUCATION}', 12),
    (hid, 'Services & Subscriptions', '#8B5CF6', 'expense', false, '{GENERAL_SERVICES}', 13),
    (hid, 'Giving',              '#F43F5E', 'expense', false, '{GOVERNMENT_AND_NON_PROFIT_DONATIONS}', 14),
    (hid, 'Taxes',               '#78716C', 'expense', false, '{GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT}', 15),
    (hid, 'Loans',               '#475569', 'expense', false, '{LOAN_PAYMENTS}', 16),
    (hid, 'Savings & Investing', '#0D9488', 'savings', false, '{TRANSFER_OUT_SAVINGS,TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS}', 17),
    (hid, 'Bank Fees',           '#B45309', 'expense', false, '{BANK_FEES}', 18),
    (hid, 'Transfers',           '#94A3B8', 'transfer', false, '{TRANSFER_IN,TRANSFER_OUT}', 19),
    (hid, 'Other',               '#9CA3AF', 'expense', false, '{OTHER,GOVERNMENT_AND_NON_PROFIT}', 99)
  on conflict do nothing;
$$;
revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- Transfers between your own accounts and card payments are excluded, but
-- money moved to savings/investments stays visible as "saved".
create or replace function public.transactions_assign_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is null and new.category_detailed is not null then
    select c.id into new.category_id
    from public.categories c
    where c.household_id = new.household_id
      and new.category_detailed = any (c.provider_categories)
    order by c.sort_order
    limit 1;
  end if;
  if new.category_id is null and new.category_primary is not null then
    select c.id into new.category_id
    from public.categories c
    where c.household_id = new.household_id
      and new.category_primary = any (c.provider_categories)
    order by c.sort_order
    limit 1;
  end if;
  if new.category_detailed in ('TRANSFER_OUT_SAVINGS', 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS') then
    new.excluded := false;
  elsif new.category_primary in ('TRANSFER_IN', 'TRANSFER_OUT')
     or new.category_detailed = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' then
    new.excluded := true;
  end if;
  return new;
end;
$$;
revoke all on function public.transactions_assign_category() from public, anon, authenticated;

-- Re-file existing savings/investment transfers.
update public.transactions t
set category_id = c.id, excluded = false
from public.categories c
where c.household_id = t.household_id
  and c.kind = 'savings'
  and t.category_detailed in ('TRANSFER_OUT_SAVINGS', 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS');

-- ---------------------------------------------------------------------------
-- 2. How each transaction counts. One place for the rules:
--    income | spending | refund | saved | excluded | ignored
--    * Only checking/savings (depository) and credit card accounts count;
--      investment and loan account activity, and hidden accounts, are ignored.
--    * Money moved to savings/investments is "saved", not spending.
--    * Transfers between your accounts and card payments are excluded.
-- ---------------------------------------------------------------------------
create view public.transaction_flows
with (security_invoker = true)
as
select
  t.id,
  t.household_id,
  t.account_id,
  t.date,
  date_trunc('month', t.date)::date as month,
  t.amount,
  t.category_id,
  case
    when a.type not in ('depository', 'credit') or a.hidden then 'ignored'
    when t.excluded then 'excluded'
    when c.kind = 'savings' then case when t.amount < 0 then 'saved' else 'excluded' end
    when c.kind = 'transfer' then 'excluded'
    when c.kind = 'income' then 'income'
    when t.amount < 0 then 'spending'
    when c.id is null then 'income'
    else 'refund'
  end as flow
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id;

-- Monthly totals per flow and category since a date (RLS applies).
create or replace function public.monthly_flows(p_from date)
returns table (month date, flow text, category_id uuid, total numeric, n bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.month, f.flow, f.category_id, sum(f.amount), count(*)
  from public.transaction_flows f
  where f.date >= p_from and f.flow not in ('ignored', 'excluded')
  group by 1, 2, 3;
$$;

-- ---------------------------------------------------------------------------
-- 3. Income sources (pay schedules)
-- ---------------------------------------------------------------------------
create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  amount numeric(12, 2) not null check (amount >= 0),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  anchor_date date,                                 -- a known payday (weekly/biweekly)
  day1 int check (day1 between 1 and 31),           -- monthly / first semimonthly day
  day2 int check (day2 between 1 and 31),           -- second semimonthly day
  created_at timestamptz not null default now(),
  check (frequency not in ('weekly', 'biweekly') or anchor_date is not null),
  check (frequency not in ('monthly', 'semimonthly') or day1 is not null),
  check (frequency <> 'semimonthly' or day2 is not null)
);
create index income_sources_household on public.income_sources(household_id);

-- ---------------------------------------------------------------------------
-- 4. Bills & debts
-- ---------------------------------------------------------------------------
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  amount numeric(12, 2) check (amount >= 0),       -- null: use the linked account's minimum payment
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'yearly')),
  due_day int not null check (due_day between 1 and 31),
  due_month int check (due_month between 1 and 12), -- quarterly/yearly anchor month
  is_debt boolean not null default false,
  balance numeric(14, 2),                           -- manual debts; linked ones use the account
  apr numeric(6, 3) check (apr between 0 and 100),
  account_id text references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  check (frequency = 'monthly' or due_month is not null)
);
create index bills_household on public.bills(household_id);
create index bills_account on public.bills(account_id);
create index bills_category on public.bills(category_id);

-- Debt details from Plaid Liabilities (APR, minimum payment, due date).
create table public.account_liabilities (
  account_id text primary key references public.accounts(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  apr numeric(6, 3),
  minimum_payment numeric(12, 2),
  next_due_date date,
  last_statement_balance numeric(14, 2),
  updated_at timestamptz not null default now()
);
create index account_liabilities_household on public.account_liabilities(household_id);

-- ---------------------------------------------------------------------------
-- 5. Security
-- ---------------------------------------------------------------------------
alter table public.income_sources enable row level security;
alter table public.bills enable row level security;
alter table public.account_liabilities enable row level security;

create policy "members manage income" on public.income_sources
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "members manage bills" on public.bills
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "members read liabilities" on public.account_liabilities
  for select using (public.is_household_member(household_id));

grant select, insert, update, delete on public.income_sources, public.bills to authenticated;
grant select on public.account_liabilities to authenticated;
grant select on public.transaction_flows to authenticated;
grant select, insert, update, delete on public.income_sources, public.bills, public.account_liabilities to service_role;
grant select on public.transaction_flows to service_role;

revoke all on function public.monthly_flows(date) from public, anon;
grant execute on function public.monthly_flows(date) to authenticated, service_role;
