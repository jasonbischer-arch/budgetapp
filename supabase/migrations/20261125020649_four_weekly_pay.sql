-- Pay every 4 weeks (e.g. a car allowance paid on every other payday Friday).
alter table public.income_sources drop constraint if exists income_sources_frequency_check;
alter table public.income_sources add constraint income_sources_frequency_check
  check (frequency in ('weekly', 'biweekly', 'fourweekly', 'semimonthly', 'monthly'));
alter table public.income_sources drop constraint if exists income_sources_check;
alter table public.income_sources add constraint income_sources_check
  check (frequency not in ('weekly', 'biweekly', 'fourweekly') or anchor_date is not null);
