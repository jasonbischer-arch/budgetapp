-- Add description/merchant to transaction_flows (used to detect paychecks).
create or replace view public.transaction_flows
with (security_invoker = true)
as
select
  t.id,
  t.household_id,
  t.account_id,
  t.date,
  date_trunc('month', t.date)::date as month,
  t.amount,
  t.category_id,
  case
    when a.type not in ('depository', 'credit') or a.hidden then 'ignored'
    when t.excluded then 'excluded'
    when c.kind = 'savings' then case when t.amount < 0 then 'saved' else 'excluded' end
    when c.kind = 'transfer' then 'excluded'
    when c.kind = 'income' then 'income'
    when t.amount < 0 then 'spending'
    when c.id is null or t.category_primary = 'OTHER' and c.provider_categories && '{OTHER}' then 'income'
    else 'refund'
  end as flow,
  t.description,
  t.merchant
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id;
