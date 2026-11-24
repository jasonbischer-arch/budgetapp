-- The month you took the "where you can cut" suggestions as your budget.
-- The suggestions stay hidden for the rest of that month and come back,
-- recalculated, on the 1st of the next.
alter table public.households add column if not exists budget_help_month date
  check (budget_help_month is null or extract(day from budget_help_month) = 1);
grant update (budget_help_month) on public.households to authenticated;
