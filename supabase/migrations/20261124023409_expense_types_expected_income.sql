-- Bills can be counted as fixed or variable expenses.
alter table public.bills
  add column if not exists expense_type text not null default 'fixed'
  check (expense_type in ('fixed', 'variable'));
grant insert (expense_type), update (expense_type) on public.bills to authenticated;

-- Where the household is taxed (2-letter state) and 401(k)-style % taken
-- from commission, for take-home estimates.
alter table public.households
  add column if not exists tax_state text check (tax_state ~ '^[A-Z]{2}$'),
  add column if not exists retirement_pct numeric(5,2) not null default 0
    check (retirement_pct >= 0 and retirement_pct <= 75);
grant update (tax_state, retirement_pct) on public.households to authenticated;

-- What a paycheck will actually be (commission, bonus), or extra income
-- that isn't on a schedule. A row with income_source_id + pay_date replaces
-- that scheduled check; a row without one is added.
create table if not exists public.expected_income (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  income_source_id uuid references public.income_sources(id) on delete cascade,
  pay_date date not null,
  name text not null check (length(name) between 1 and 80),
  amount numeric(12,2) not null check (amount >= 0 and amount < 10000000),
  gross numeric(12,2) check (gross is null or (gross >= 0 and gross < 10000000)),
  tax_rate numeric(5,2) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  created_at timestamptz not null default now()
);
create unique index if not exists expected_income_one_per_check
  on public.expected_income (income_source_id, pay_date) where income_source_id is not null;
create index if not exists expected_income_household_date on public.expected_income (household_id, pay_date);

alter table public.expected_income enable row level security;
create policy "members manage expected income" on public.expected_income
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
grant select, insert, update, delete on public.expected_income to authenticated;
