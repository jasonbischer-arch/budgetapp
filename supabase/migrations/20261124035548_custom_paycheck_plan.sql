-- Your own paycheck plan: which paycheck pays each bill. A bill can be
-- split: rows with an amount pay that much, a row without one pays the rest.
create table if not exists public.plan_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  income_source_id uuid not null references public.income_sources(id) on delete cascade,
  amount numeric(12,2) check (amount is null or (amount > 0 and amount < 10000000)),
  created_at timestamptz not null default now(),
  unique (bill_id, income_source_id)
);
create index if not exists plan_rules_household on public.plan_rules (household_id);
create index if not exists plan_rules_source on public.plan_rules (income_source_id);

alter table public.plan_rules enable row level security;
create policy "members manage plan rules" on public.plan_rules
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
grant select, insert, update, delete on public.plan_rules to authenticated;

-- 'even' = automatic, every check keeps the same; 'mine' = your rules first.
alter table public.households add column if not exists plan_mode text not null default 'even'
  check (plan_mode in ('even', 'mine'));
grant update (plan_mode) on public.households to authenticated;
