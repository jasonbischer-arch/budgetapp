-- Pay a share of a bill from a check (e.g. 1/4 of daycare from each check).
alter table public.plan_rules
  add column if not exists fraction numeric(5,4) check (fraction is null or (fraction > 0 and fraction <= 1));
-- A bill can now be on two checks from the same paycheck (its 1st and 2nd
-- check of the month), so one row per bill + paycheck + check.
alter table public.plan_rules drop constraint if exists plan_rules_bill_id_income_source_id_key;
create unique index if not exists plan_rules_bill_source_slot
  on public.plan_rules (bill_id, income_source_id, coalesce(check_slot, 0));
