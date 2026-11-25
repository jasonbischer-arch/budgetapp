-- Which of that paycheck's checks in a month pays the bill (1 = its first
-- check of the month, 2 = its second ...). Empty = the latest check before
-- the bill is due.
alter table public.plan_rules
  add column if not exists check_slot smallint check (check_slot is null or check_slot between 1 and 5);
