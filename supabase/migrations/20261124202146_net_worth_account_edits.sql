-- Edit how connected accounts show in net worth: a nickname, a different
-- group, or leave one out. The bank's own name and balance stay as they are,
-- and budgets/transactions aren't affected.
alter table public.accounts
  add column if not exists nickname text check (nickname is null or char_length(btrim(nickname)) between 1 and 60),
  add column if not exists net_worth_excluded boolean not null default false,
  add column if not exists net_worth_kind text check (net_worth_kind is null or net_worth_kind in (
    'cash','investment','home','vehicle','other',
    'mortgage','auto_loan','student_loan','credit_card','loan','debt'));
grant update (nickname, net_worth_excluded, net_worth_kind) on public.accounts to authenticated;

create or replace function public.net_worth_items()
returns table(household_id uuid, section text, kind text, name text, amount numeric, source text, ref_id text, loan_ref text)
language sql stable set search_path to '' as $function$
  select a.household_id, 'asset',
         case when a.net_worth_kind in ('cash','investment','home','vehicle','other') then a.net_worth_kind
              when a.type = 'investment' then 'investment' else 'cash' end,
         coalesce(a.nickname, a.name || coalesce(' ••' || a.last_four, '')),
         coalesce(a.balance_ledger, a.balance_available, 0),
         'bank', a.id, null::text
  from public.accounts a
  where a.type in ('depository', 'investment') and not a.hidden and not a.net_worth_excluded

  union all
  select a.household_id, 'liability',
         case
           when a.net_worth_kind in ('mortgage','auto_loan','student_loan','credit_card','loan','debt') then a.net_worth_kind
           when a.type = 'credit' then 'credit_card'
           when a.subtype = 'mortgage' or a.subtype = 'home equity' then 'mortgage'
           when a.subtype = 'auto' then 'auto_loan'
           when a.subtype = 'student' then 'student_loan'
           else 'loan'
         end,
         coalesce(a.nickname, a.name || coalesce(' ••' || a.last_four, '')),
         abs(coalesce(a.balance_ledger, 0)),
         'bank', a.id, null
  from public.accounts a
  where a.type in ('credit', 'loan') and not a.hidden and not a.net_worth_excluded

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
$function$;
