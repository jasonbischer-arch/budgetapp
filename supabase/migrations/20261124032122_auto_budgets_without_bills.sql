-- Automatic budgets: a category's average leaves out payments a bill already
-- covers (e.g. Health without the monthly Gokadar bill), so they aren't
-- budgeted twice.
create or replace function public.refresh_auto_budgets()
returns integer language plpgsql set search_path to '' as $function$
declare
  n int;
begin
  with bounds as (
    select household_id,
      greatest(
        date_trunc('month', now() - interval '12 months')::date,
        case when extract(day from min(date)) <= 3
          then date_trunc('month', min(date))::date
          else (date_trunc('month', min(date)) + interval '1 month')::date
        end
      ) as first_month,
      date_trunc('month', now())::date as this_month
    from public.transactions
    group by household_id
  ),
  months as (
    select household_id, first_month, this_month,
      ((extract(year from this_month) - extract(year from first_month)) * 12
        + extract(month from this_month) - extract(month from first_month))::int as n
    from bounds
  ),
  spend as (
    select f.household_id, f.category_id, sum(-f.amount) as total, m.n
    from public.transaction_flows f
    join months m on m.household_id = f.household_id
    where f.flow in ('spending', 'refund')
      and f.category_id is not null
      and f.bill_id is null
      and f.month >= m.first_month
      and f.month < m.this_month
      and m.n > 0
    group by f.household_id, f.category_id, m.n
  )
  update public.categories c
  set monthly_budget = ceil(s.total / s.n / 10) * 10,
      budget_auto = true
  from spend s
  where c.id = s.category_id
    and c.kind = 'expense'
    and c.expense_type = 'variable'
    and (c.budget_auto or c.monthly_budget is null)
    and s.total > 0
    and c.monthly_budget is distinct from ceil(s.total / s.n / 10) * 10;
  get diagnostics n = row_count;
  return n;
end;
$function$;
