-- My plan: what you save from a check, every month (a flat amount or a % of
-- the check). Same check model as bills: a paycheck + its 1st/2nd check of the month.
create table if not exists public.plan_savings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  income_source_id uuid not null references public.income_sources(id) on delete cascade,
  check_slot smallint check (check_slot is null or check_slot between 1 and 5),
  amount numeric(12,2) check (amount is null or (amount > 0 and amount < 10000000)),
  percent numeric(5,2) check (percent is null or (percent > 0 and percent <= 100)),
  created_at timestamptz not null default now(),
  check ((amount is null) <> (percent is null))
);
create unique index if not exists plan_savings_check
  on public.plan_savings (income_source_id, coalesce(check_slot, 0));
create index if not exists plan_savings_household on public.plan_savings (household_id);
alter table public.plan_savings enable row level security;
create policy "members manage plan savings" on public.plan_savings
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
grant select, insert, update, delete on public.plan_savings to authenticated;
