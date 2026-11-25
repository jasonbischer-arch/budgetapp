-- Fetch the S&P 500 close every weekday morning (FRED posts the previous
-- trading day's close overnight).
select cron.schedule(
  'market-prices-daily',
  '41 13 * * 2-6',
  $$
  select net.http_post(
    url := 'https://fdlwfkgnsooulmrfyobv.supabase.co/functions/v1/market-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
