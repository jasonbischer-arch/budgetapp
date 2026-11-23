-- Net worth: everything you own minus everything you owe.
--
-- Assets
--   cash          checking & savings (connected depository accounts)
--   investment    brokerage, 401(k), IRA, HSA (connected investment accounts)
--   home/vehicle/investment/cash/other   things you add yourself, valued at
--                 your estimate, grown or depreciated by a yearly rate
-- Liabilities
--   credit_card   connected credit cards
--   mortgage, auto_loan, student_loan, loan   connected loan accounts
--   debt          debts entered in Bills that aren't connected to a bank
--
-- Each debt is counted exactly once. A home or vehicle can point at its loan
-- (connected account or manual debt) so the app can show equity.
-- Hidden accounts are left out, as everywhere else in the app.

create table public.manual_assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('home', 'vehicle', 'investment', 'cash', 'other')),
  value numeric(14, 2) not null check (value >= 0),
  -- The date `value` was right; the estimate grows/shrinks from here.
  value_date date not null default current_date,
  -- Yearly change: e.g. +3 for a home, -15 for a car.
  annual_change_pct numeric(5, 2) not null default 0 check (annual_change_pct between -50 and 50),
  loan_account_id text references public.accounts(id) on delete set null,
  loan_bill_id uuid references public.bills(id) on delete set null,
  created_at timestamptz not null default now()
);
create index manual_assets_household on public.manual_assets(household_id);
create index manual_assets_loan_account on public.manual_assets(loan_account_id);
create index manual_assets_loan_bill on public.manual_assets(loan_bill_id);

alter table public.manual_assets enable row level security;
create policy "members manage assets" on public.manual_assets
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
grant select, insert, update, delete on public.manual_assets to authenticated;
grant select, insert, update, delete on public.manual_assets to service_role;

-- Every line of the balance sheet. Runs with the caller's permissions, so
-- members see only their household.
create or replace function public.net_worth_items()
returns table (
  household_id uuid,
  section text,      -- asset | liability
  kind text,
  name text,
  amount numeric,    -- always positive
  source text,       -- bank | manual
  ref_id text,
  loan_ref text      -- for homes/vehicles: the linked loan's ref_id
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Connected checking/savings and investments
  select a.household_id, 'asset',
         case when a.type = 'investment' then 'investment' else 'cash' end,
         a.name || coalesce(' ••' || a.last_four, ''),
         coalesce(a.balance_ledger, a.balance_available, 0),
         'bank', a.id, null::text
  from public.accounts a
  where a.type in ('depository', 'investment') and not a.hidden

  union all
  -- Connected credit cards and loans
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
  -- Debts entered in Bills (not linked to a connected account)
  select b.household_id, 'liability',
         coalesce(
           (select case m.kind when 'home' then 'mortgage' when 'vehicle' then 'auto_loan' end
            from public.manual_assets m where m.loan_bill_id = b.id limit 1),
           'debt'),
         b.name, b.balance, 'manual', b.id::text, null
  from public.bills b
  where b.is_debt and b.account_id is null and coalesce(b.balance, 0) > 0

  union all
  -- Things you own, at today's estimated value
  select m.household_id, 'asset', m.kind, m.name,
         round(m.value * power(1 + m.annual_change_pct / 100, (current_date - m.value_date) / 365.25), 2),
         'manual', m.id::text,
         coalesce(m.loan_account_id, m.loan_bill_id::text)
  from public.manual_assets m;
$$;

revoke all on function public.net_worth_items() from public, anon;
grant execute on function public.net_worth_items() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- History: one snapshot per household per month (latest value that month)
-- ---------------------------------------------------------------------------
create table public.net_worth_history (
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null,
  assets numeric(16, 2) not null,
  liabilities numeric(16, 2) not null,
  net_worth numeric(16, 2) not null,
  recorded_at timestamptz not null default now(),
  primary key (household_id, month)
);

alter table public.net_worth_history enable row level security;
create policy "members read history" on public.net_worth_history
  for select using (public.is_household_member(household_id));
grant select on public.net_worth_history to authenticated;
grant select, insert, update, delete on public.net_worth_history to service_role;

-- Records this month's snapshot. Definer so members can't write arbitrary
-- history; it only ever writes the caller's own household (or, when run by
-- the scheduler with no signed-in user, every household).
create or replace function public.record_net_worth()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.net_worth_history (household_id, month, assets, liabilities, net_worth, recorded_at)
  select i.household_id,
         date_trunc('month', current_date)::date,
         coalesce(sum(i.amount) filter (where i.section = 'asset'), 0),
         coalesce(sum(i.amount) filter (where i.section = 'liability'), 0),
         coalesce(sum(i.amount) filter (where i.section = 'asset'), 0)
           - coalesce(sum(i.amount) filter (where i.section = 'liability'), 0),
         now()
  from public.net_worth_items() i
  where auth.uid() is null or public.is_household_member(i.household_id)
  group by i.household_id
  on conflict (household_id, month) do update
    set assets = excluded.assets,
        liabilities = excluded.liabilities,
        net_worth = excluded.net_worth,
        recorded_at = excluded.recorded_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.record_net_worth() from public, anon;
grant execute on function public.record_net_worth() to authenticated, service_role;

-- Daily snapshot at 12:23 UTC (after the bank sync).
select cron.unschedule('net-worth-snapshot')
where exists (select 1 from cron.job where jobname = 'net-worth-snapshot');
select cron.schedule('net-worth-snapshot', '23 12 * * *', $$ select public.record_net_worth(); $$);
