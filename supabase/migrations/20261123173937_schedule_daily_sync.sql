-- Daily bank sync at 11:17 UTC. The function URL is project specific:
-- replace the project ref if you deploy to a different Supabase project.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('bank-daily-sync')
where exists (select 1 from cron.job where jobname = 'bank-daily-sync');

select cron.schedule(
  'bank-daily-sync',
  '17 11 * * *',
  $$
  select net.http_post(
    url := 'https://fdlwfkgnsooulmrfyobv.supabase.co/functions/v1/plaid-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
