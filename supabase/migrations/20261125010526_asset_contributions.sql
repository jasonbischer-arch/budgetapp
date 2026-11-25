-- Accounts that can't connect (a 401k, pension, HSA): track them from the
-- last statement balance, the yearly return you expect, and what goes in
-- each month (you + employer match).
alter table public.manual_assets
  add column if not exists monthly_contribution numeric(12,2) not null default 0
    check (monthly_contribution >= 0 and monthly_contribution < 1000000);
grant insert (monthly_contribution), update (monthly_contribution) on public.manual_assets to authenticated;

-- Today's estimate for an asset you entered. Without contributions this is
-- exactly the old formula (value grown by the yearly rate). With them, each
-- month's contribution grows at the same rate from when it went in.
create or replace function public.asset_estimate(
  p_value numeric, p_value_date date, p_annual_pct numeric, p_monthly numeric
) returns numeric language sql immutable set search_path to '' as $$
  with t as (
    select greatest(0, (current_date - p_value_date) / 30.436875) as months,
           power(1 + p_annual_pct / 100, 1.0 / 12) - 1 as r
  )
  select round(
    p_value * power(1 + t.r, t.months)
    + coalesce(p_monthly, 0) * case when abs(t.r) < 1e-12 then t.months
                                    else (power(1 + t.r, t.months) - 1) / t.r end,
    2)
  from t;
$$;

-- (net_worth_items() was updated here to use asset_estimate(); the next
-- migration, sp500_tracking, replaces it again with index support.)
