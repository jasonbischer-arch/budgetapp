-- Daily closes of market indexes (public data), filled by the
-- market-prices Edge Function. Readable by any signed-in user.
create table if not exists public.market_prices (
  symbol text not null check (symbol in ('SP500')),
  date date not null,
  close numeric(14,4) not null check (close > 0),
  primary key (symbol, date)
);
alter table public.market_prices enable row level security;
create policy "signed-in users read market prices" on public.market_prices
  for select to authenticated using (true);
grant select on public.market_prices to authenticated;

-- An asset you track yourself can follow an index instead of a fixed rate.
alter table public.manual_assets
  add column if not exists tracks_index text check (tracks_index is null or tracks_index in ('SP500'));
grant insert (tracks_index), update (tracks_index) on public.manual_assets to authenticated;

-- The index close on a date (or the last trading day before it).
create or replace function public.index_close(p_symbol text, p_date date)
returns numeric language sql stable set search_path to '' as $$
  select close from public.market_prices
  where symbol = p_symbol and date <= p_date
  order by date desc limit 1;
$$;

-- Value today for an asset that follows an index: the balance you entered
-- moves with the index since that day, and each monthly contribution moves
-- with it from the month it went in. Without price data yet, it's simply
-- the balance plus contributions.
create or replace function public.index_asset_estimate(
  p_symbol text, p_value numeric, p_value_date date, p_monthly numeric
) returns numeric language sql stable set search_path to '' as $$
  with now_close as (select public.index_close(p_symbol, current_date) as c),
  start_close as (select public.index_close(p_symbol, p_value_date) as c),
  contributions as (
    select coalesce(sum(
      coalesce(p_monthly, 0) * coalesce((select c from now_close) / nullif(public.index_close(p_symbol, d::date), 0), 1)
    ), 0) as total
    from generate_series(p_value_date + interval '1 month', current_date::timestamp, interval '1 month') as d
  )
  select round(
    p_value * coalesce((select c from now_close) / nullif((select c from start_close), 0), 1)
    + (select total from contributions),
    2);
$$;

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
         case when m.tracks_index is not null
           then public.index_asset_estimate(m.tracks_index, m.value, m.value_date, m.monthly_contribution)
           else public.asset_estimate(m.value, m.value_date, m.annual_change_pct, m.monthly_contribution)
         end,
         'manual', m.id::text,
         coalesce(m.loan_account_id, m.loan_bill_id::text)
  from public.manual_assets m;
$function$;
