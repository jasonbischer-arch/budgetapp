-- Automatic home values from RentCast's valuation API (opt-in per home).
alter table public.manual_assets
  add column address text check (address is null or char_length(address) between 5 and 200),
  -- When on, the server refreshes `value` monthly from the address.
  add column auto_value boolean not null default false,
  add column value_source text not null default 'manual' check (value_source in ('manual', 'rentcast')),
  add column value_low numeric(14, 2),
  add column value_high numeric(14, 2),
  add column valued_at timestamptz,
  add column value_error text;

alter table public.manual_assets
  add constraint auto_value_needs_home_address
  check (not auto_value or (kind = 'home' and address is not null));

-- Monthly refresh on the 1st at 13:07 UTC (the function skips homes valued
-- in the last 25 days, so retries and manual refreshes don't waste lookups).
select cron.unschedule('home-values-monthly')
where exists (select 1 from cron.job where jobname = 'home-values-monthly');

select cron.schedule(
  'home-values-monthly',
  '7 13 1 * *',
  $$
  select net.http_post(
    url := 'https://fdlwfkgnsooulmrfyobv.supabase.co/functions/v1/home-values',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
