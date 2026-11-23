-- Budget app schema: shared household, Teller bank connections, accounts,
-- transactions and per-category monthly budgets.
--
-- Security model:
--   * Every row belongs to a household. Row Level Security limits reads and
--     writes to members of that household.
--   * Teller access tokens live in `teller_tokens`, which has RLS on and NO
--     policies, so only the service role (Edge Functions) can read them.
--     The app never sees a token after enrollment.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8)),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Keep this simple for a two-person app: one household per user.
create unique index household_members_one_per_user on public.household_members(user_id);

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Categories (with an optional monthly budget)
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text not null default '#6B7280',
  is_income boolean not null default false,
  monthly_budget numeric(12, 2),
  -- Teller category strings that map to this category on import.
  teller_categories text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

-- ---------------------------------------------------------------------------
-- Teller enrollments (one per bank login) and their secret tokens
-- ---------------------------------------------------------------------------
create table public.teller_enrollments (
  id text primary key,                     -- Teller enrollment id
  household_id uuid not null references public.households(id) on delete cascade,
  institution_name text,
  status text not null default 'active' check (status in ('active', 'disconnected', 'error')),
  last_error text,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.teller_tokens (
  enrollment_id text primary key references public.teller_enrollments(id) on delete cascade,
  access_token text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Accounts and transactions (synced from Teller)
-- ---------------------------------------------------------------------------
create table public.accounts (
  id text primary key,                     -- Teller account id
  household_id uuid not null references public.households(id) on delete cascade,
  enrollment_id text not null references public.teller_enrollments(id) on delete cascade,
  name text not null,
  institution_name text,
  type text not null,                      -- depository | credit
  subtype text,                            -- checking | savings | credit_card | ...
  last_four text,
  currency text not null default 'USD',
  status text,
  balance_available numeric(14, 2),
  balance_ledger numeric(14, 2),
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id text primary key,                     -- Teller transaction id
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null references public.accounts(id) on delete cascade,
  date date not null,
  description text not null,
  merchant text,
  -- Normalized: negative = money out (spending), positive = money in.
  amount numeric(14, 2) not null,
  status text not null default 'posted',   -- posted | pending
  teller_category text,
  category_id uuid references public.categories(id) on delete set null,
  notes text,
  excluded boolean not null default false, -- e.g. transfers / card payments
  updated_at timestamptz not null default now()
);

create index transactions_household_date on public.transactions(household_id, date desc);
create index transactions_account on public.transactions(account_id);

-- On first import, map Teller's category to the household's category.
-- Runs on INSERT only, so later syncs never overwrite a category you picked.
create or replace function public.transactions_assign_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is null and new.teller_category is not null then
    select c.id into new.category_id
    from public.categories c
    where c.household_id = new.household_id
      and new.teller_category = any (c.teller_categories)
    order by c.sort_order
    limit 1;
  end if;
  return new;
end;
$$;

create trigger transactions_assign_category
before insert on public.transactions
for each row execute function public.transactions_assign_category();

-- ---------------------------------------------------------------------------
-- Household setup RPCs
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_categories(hid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.categories (household_id, name, color, is_income, teller_categories, sort_order) values
    (hid, 'Income',          '#16A34A', true,  '{income}', 0),
    (hid, 'Groceries',       '#22C55E', false, '{groceries}', 1),
    (hid, 'Dining & Bars',   '#F97316', false, '{dining,bar}', 2),
    (hid, 'Housing & Home',  '#0EA5E9', false, '{home,accommodation}', 3),
    (hid, 'Utilities & Phone','#6366F1', false, '{utilities,phone}', 4),
    (hid, 'Transportation',  '#EAB308', false, '{fuel,transport,transportation}', 5),
    (hid, 'Shopping',        '#EC4899', false, '{shopping,clothing,electronics,office}', 6),
    (hid, 'Entertainment',   '#A855F7', false, '{entertainment,sport}', 7),
    (hid, 'Health',          '#EF4444', false, '{health}', 8),
    (hid, 'Insurance',       '#64748B', false, '{insurance}', 9),
    (hid, 'Subscriptions',   '#8B5CF6', false, '{software,service}', 10),
    (hid, 'Education',       '#14B8A6', false, '{education}', 11),
    (hid, 'Giving',          '#F43F5E', false, '{charity}', 12),
    (hid, 'Taxes',           '#78716C', false, '{tax}', 13),
    (hid, 'Loans',           '#475569', false, '{loan}', 14),
    (hid, 'Savings & Investing','#0D9488', false, '{investment}', 15),
    (hid, 'Other',           '#9CA3AF', false, '{general,advertising}', 99)
  on conflict do nothing;
$$;

create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'You already belong to a household';
  end if;

  insert into households (name) values (coalesce(nullif(trim(household_name), ''), 'Our Household'))
  returning id into hid;
  insert into household_members (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  perform seed_default_categories(hid);
  return hid;
end;
$$;

create or replace function public.join_household(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'You already belong to a household';
  end if;

  select id into hid from households where invite_code = upper(trim(code));
  if hid is null then
    raise exception 'Invite code not found';
  end if;
  insert into household_members (household_id, user_id, role) values (hid, auth.uid(), 'member');
  return hid;
end;
$$;

revoke all on function public.create_household(text) from public, anon;
revoke all on function public.join_household(text) from public, anon;
revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.categories enable row level security;
alter table public.teller_enrollments enable row level security;
alter table public.teller_tokens enable row level security;  -- no policies: service role only
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;

create policy "members read household" on public.households
  for select using (public.is_household_member(id));
create policy "members rename household" on public.households
  for update using (public.is_household_member(id));

create policy "members read membership" on public.household_members
  for select using (public.is_household_member(household_id));

create policy "members manage categories" on public.categories
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "members read enrollments" on public.teller_enrollments
  for select using (public.is_household_member(household_id));
create policy "members remove enrollments" on public.teller_enrollments
  for delete using (public.is_household_member(household_id));

create policy "members read accounts" on public.accounts
  for select using (public.is_household_member(household_id));
create policy "members update accounts" on public.accounts
  for update using (public.is_household_member(household_id));

create policy "members read transactions" on public.transactions
  for select using (public.is_household_member(household_id));
create policy "members update transactions" on public.transactions
  for update using (public.is_household_member(household_id));

-- Members may only edit the user-owned columns of synced data.
revoke update on public.accounts from authenticated;
grant update (hidden, name) on public.accounts to authenticated;
revoke update on public.transactions from authenticated;
grant update (category_id, notes, excluded) on public.transactions to authenticated;
revoke all on public.teller_tokens from anon, authenticated;
