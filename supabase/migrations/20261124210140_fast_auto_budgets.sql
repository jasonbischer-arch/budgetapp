-- Same result as before, much faster: only the caller's household, and the
-- category totals are computed once (the old single statement re-ran the
-- spending query for every category and took 20s+).
create or replace function public.refresh_auto_budgets()
returns integer language plpgsql set search_path to '' as $function$
declare
  n int;
  hid uuid;
  first_month date;
  this_month date := date_trunc('month', now())::date;
  months int;
begin
  select m.household_id into hid from public.household_members m where m.user_id = auth.uid() limit 1;
  if hid is null then return 0; end if;

  -- Complete months the bank history covers (up to 12).
  select greatest(
           date_trunc('month', now() - interval '12 months')::date,
           case when extract(day from min(t.date)) <= 3
             then date_trunc('month', min(t.date))::date
             else (date_trunc('month', min(t.date)) + interval '1 month')::date
           end)
    into first_month
    from public.transactions t where t.household_id = hid;
  if first_month is null then return 0; end if;
  months := ((extract(year from this_month) - extract(year from first_month)) * 12
             + extract(month from this_month) - extract(month from first_month))::int;
  if months <= 0 then return 0; end if;

  -- Each category's average, leaving out payments a bill already covers.
  with spend as materialized (
    select f.category_id, sum(-f.amount) as total
    from public.transaction_flows f
    where f.household_id = hid
      and f.flow in ('spending', 'refund')
      and f.category_id is not null
      and f.bill_id is null
      and f.date >= first_month
      and f.date < this_month
    group by f.category_id
  )
  update public.categories c
  set monthly_budget = ceil(s.total / months / 10) * 10,
      budget_auto = true
  from spend s
  where c.id = s.category_id
    and c.household_id = hid
    and c.kind = 'expense'
    and c.expense_type = 'variable'
    and (c.budget_auto or c.monthly_budget is null)
    and s.total > 0
    and c.monthly_budget is distinct from ceil(s.total / months / 10) * 10;
  get diagnostics n = row_count;
  return n;
end;
$function$;
