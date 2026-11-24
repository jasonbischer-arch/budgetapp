-- Every paid home-value lookup (RentCast) is recorded here before it's made,
-- so the limits below hold even if someone spams the button or the app.
create table if not exists public.home_value_lookups (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid,
  called_at timestamptz not null default now()
);
create index if not exists home_value_lookups_household_time on public.home_value_lookups (household_id, called_at);
create index if not exists home_value_lookups_time on public.home_value_lookups (called_at);

-- Server only: no app user can read or write it.
alter table public.home_value_lookups enable row level security;
revoke all on public.home_value_lookups from anon, authenticated;

-- Reserves one lookup, atomically. Returns:
--   'ok'               go ahead
--   'household_limit'  this household already had its lookup this month
--   'global_limit'     the whole app hit its monthly cap (protects the bill)
create or replace function public.claim_home_lookup(p_household uuid, p_asset uuid, p_global_cap int)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  month_start timestamptz := date_trunc('month', now());
begin
  -- One claim at a time, so two simultaneous requests can't both pass.
  perform pg_advisory_xact_lock(hashtext('home_value_lookups'));
  if exists (select 1 from home_value_lookups where household_id = p_household and called_at >= month_start) then
    return 'household_limit';
  end if;
  if (select count(*) from home_value_lookups where called_at >= month_start) >= p_global_cap then
    return 'global_limit';
  end if;
  insert into home_value_lookups (household_id, asset_id) values (p_household, p_asset);
  return 'ok';
end;
$$;
revoke execute on function public.claim_home_lookup(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_home_lookup(uuid, uuid, int) to service_role;
