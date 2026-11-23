-- Automatic paycheck detection.
--
-- After each bank sync, the server looks for regular deposits from the same
-- payer and keeps an income source per paycheck up to date:
--   auto = true        managed by detection (amount/schedule follow the bank)
--   auto = false       added or edited by you; detection only refreshes stats
--   dismissed = true   you deleted a detected paycheck; never re-added

alter table public.income_sources
  add column auto boolean not null default false,
  add column detection_key text,
  add column dismissed boolean not null default false,
  -- When a twice-monthly/monthly payday lands on a weekend.
  add column weekend_shift text not null default 'before'
    check (weekend_shift in ('none', 'before', 'after')),
  add column average_amount numeric(12, 2),
  add column last_amount numeric(12, 2),
  add column last_paid date,
  add column occurrences int,
  add column detected_at timestamptz;

create unique index income_sources_detection
  on public.income_sources (household_id, detection_key)
  where detection_key is not null;

-- Expose Plaid's detailed category on the flows view (e.g. INCOME_WAGES).
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
  t.merchant,
  t.category_detailed
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id;
