-- Estimated commission per month, before taxes: a slow month and a good
-- month. Budgets use the slow month so they hold up when commission is low.
alter table public.households
  add column if not exists commission_low numeric(12,2) check (commission_low is null or (commission_low >= 0 and commission_low < 10000000)),
  add column if not exists commission_high numeric(12,2) check (commission_high is null or (commission_high >= 0 and commission_high < 10000000));
grant update (commission_low, commission_high) on public.households to authenticated;
