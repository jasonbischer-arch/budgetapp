-- Daily bank sync at 11:17 UTC. The function URL is project specific:
-- replace the project ref if you deploy to a different Supabase project.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('teller-daily-sync')
where exists (select 1 from cron.job where jobname = 'teller-daily-sync');

select cron.schedule(
  'teller-daily-sync',
  '17 11 * * *',
  $$
  select net.http_post(
    url := 'https://fdlwfkgnsooulmrfyobv.supabase.co/functions/v1/teller-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
