-- Detected bills/monthly payments, and debts that pay down month by month.

alter table public.bills
  -- Detection (same rules as paychecks): auto = managed by detection;
  -- editing makes it yours; deleting a detected bill hides it (dismissed).
  add column auto boolean not null default false,
  add column detection_key text,
  add column dismissed boolean not null default false,
  add column last_paid date,
  add column occurrences int,
  -- For debts you enter yourself: the date `balance` was right. The balance
  -- then pays down each month: interest added, payment subtracted.
  add column balance_date date,
  -- What kind of debt, so net worth groups it right.
  add column debt_kind text check (debt_kind in ('auto_loan', 'mortgage', 'student_loan', 'personal_loan', 'other'));

update public.bills set balance_date = coalesce(created_at::date, current_date)
where balance is not null and balance_date is null;

create unique index bills_detection on public.bills (household_id, detection_key)
  where detection_key is not null;

-- ---------------------------------------------------------------------------
-- Standard amortization: after n monthly payments,
--   B_n = B0 (1 + r)^n - P ((1 + r)^n - 1) / r,   r = APR / 12
-- (B0 - P n when there's no interest), never below zero.
-- n counts the due dates passed since the balance was entered.
-- ---------------------------------------------------------------------------
create or replace function public.payments_since(p_from date, p_due_day int, p_to date default current_date)
returns int
language sql
immutable
set search_path = ''
as $$
  select greatest(0,
    ((extract(year from p_to) - extract(year from p_from)) * 12
      + extract(month from p_to) - extract(month from p_from))::int
    + case when extract(day from p_to) >= least(p_due_day, extract(day from (date_trunc('month', p_to) + interval '1 month - 1 day'))) then 1 else 0 end
    - case when extract(day from p_from) >= least(p_due_day, extract(day from (date_trunc('month', p_from) + interval '1 month - 1 day'))) then 1 else 0 end
  );
$$;

create or replace function public.amortized_balance(
  p_balance numeric, p_apr numeric, p_payment numeric, p_months int
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_balance is null then null
    when coalesce(p_payment, 0) <= 0 or p_months <= 0 then p_balance
    when coalesce(p_apr, 0) = 0 then greatest(0, p_balance - p_payment * p_months)
    else greatest(0, round(
      p_balance * power(1 + p_apr / 1200, p_months)
      - p_payment * (power(1 + p_apr / 1200, p_months) - 1) / (p_apr / 1200), 2))
  end;
$$;

grant execute on function public.payments_since(date, int, date) to authenticated, service_role;
grant execute on function public.amortized_balance(numeric, numeric, numeric, int) to authenticated, service_role;

-- Net worth: manual debts use the paid-down balance; dismissed bills are out.
create or replace function public.net_worth_items()
returns table (
  household_id uuid,
  section text,
  kind text,
  name text,
  amount numeric,
  source text,
  ref_id text,
  loan_ref text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.household_id, 'asset',
         case when a.type = 'investment' then 'investment' else 'cash' end,
         a.name || coalesce(' ••' || a.last_four, ''),
         coalesce(a.balance_ledger, a.balance_available, 0),
         'bank', a.id, null::text
  from public.accounts a
  where a.type in ('depository', 'investment') and not a.hidden

  union all
  select a.household_id, 'liability',
         case
           when a.type = 'credit' then 'credit_card'
           when a.subtype = 'mortgage' or a.subtype = 'home equity' then 'mortgage'
           when a.subtype = 'auto' then 'auto_loan'
           when a.subtype = 'student' then 'student_loan'
           else 'loan'
         end,
         a.name || coalesce(' ••' || a.last_four, ''),
         abs(coalesce(a.balance_ledger, 0)),
         'bank', a.id, null
  from public.accounts a
  where a.type in ('credit', 'loan') and not a.hidden

  union all
  select x.household_id, 'liability', x.kind, x.name, x.amount, 'manual', x.ref_id, null
  from (
    select b.household_id,
           coalesce(
             (select case m.kind when 'home' then 'mortgage' when 'vehicle' then 'auto_loan' end
              from public.manual_assets m where m.loan_bill_id = b.id limit 1),
             case b.debt_kind
               when 'auto_loan' then 'auto_loan'
               when 'mortgage' then 'mortgage'
               when 'student_loan' then 'student_loan'
               when 'personal_loan' then 'loan'
               else 'debt'
             end) as kind,
           b.name,
           public.amortized_balance(
             b.balance, b.apr, b.amount,
             public.payments_since(coalesce(b.balance_date, current_date), b.due_day)) as amount,
           b.id::text as ref_id
    from public.bills b
    where b.is_debt and b.account_id is null and not b.dismissed and coalesce(b.balance, 0) > 0
  ) x
  where x.amount > 0

  union all
  select m.household_id, 'asset', m.kind, m.name,
         round(m.value * power(1 + m.annual_change_pct / 100, (current_date - m.value_date) / 365.25), 2),
         'manual', m.id::text,
         coalesce(m.loan_account_id, m.loan_bill_id::text)
  from public.manual_assets m;
$$;

revoke all on function public.net_worth_items() from public, anon;
grant execute on function public.net_worth_items() to authenticated, service_role;
