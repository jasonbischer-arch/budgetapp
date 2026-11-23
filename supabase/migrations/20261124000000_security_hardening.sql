-- Security hardening:
--  1. Teller access tokens are encrypted with Supabase Vault. teller_tokens
--     keeps only a pointer to the Vault secret; reading a token requires
--     get_teller_token(), which only the service role (Edge Functions) can run.
--  2. Removing a bank goes through the teller-disconnect Edge Function, which
--     revokes access at Teller first. Members can no longer delete
--     enrollments directly.
--  3. The daily sync job authenticates with a random secret generated here and
--     kept in Vault, so nobody ever has to copy it around.
--  4. A timestamp for throttling manual "Sync now" requests.

-- ---------------------------------------------------------------------------
-- 1. Encrypted bank tokens
-- ---------------------------------------------------------------------------
drop table if exists public.teller_tokens;

create table public.teller_tokens (
  enrollment_id text primary key references public.teller_enrollments(id) on delete cascade,
  secret_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.teller_tokens enable row level security;  -- no policies
revoke all on public.teller_tokens from anon, authenticated;

create or replace function public.store_teller_token(p_enrollment_id text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  select secret_id into sid from public.teller_tokens where enrollment_id = p_enrollment_id;
  if sid is null then
    sid := vault.create_secret(
      p_token,
      'teller_token_' || p_enrollment_id || '_' || extract(epoch from now())::bigint,
      'Teller access token'
    );
    insert into public.teller_tokens (enrollment_id, secret_id) values (p_enrollment_id, sid);
  else
    perform vault.update_secret(sid, p_token);
  end if;
end;
$$;

create or replace function public.get_teller_token(p_enrollment_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
  from public.teller_tokens t
  join vault.decrypted_secrets d on d.id = t.secret_id
  where t.enrollment_id = p_enrollment_id;
$$;

-- When a token row goes away (bank removed), delete its Vault secret too.
create or replace function public.teller_tokens_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;

create trigger teller_tokens_cleanup
after delete on public.teller_tokens
for each row execute function public.teller_tokens_cleanup();

-- ---------------------------------------------------------------------------
-- 2. Bank removal only through the server
-- ---------------------------------------------------------------------------
drop policy if exists "members remove enrollments" on public.teller_enrollments;

-- ---------------------------------------------------------------------------
-- 3. Secret for the scheduled sync
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret for the scheduled teller-sync call'
    );
  end if;
end;
$$;

create or replace function public.get_cron_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret';
$$;

-- ---------------------------------------------------------------------------
-- 4. Manual sync throttle
-- ---------------------------------------------------------------------------
alter table public.households add column if not exists last_manual_sync_at timestamptz;

-- Members may rename the household but not change its invite code or
-- server-managed columns.
revoke update on public.households from anon, authenticated;
grant update (name) on public.households to authenticated;

-- ---------------------------------------------------------------------------
-- Function permissions: server-only helpers are callable by service_role only.
-- ---------------------------------------------------------------------------
revoke all on function public.store_teller_token(text, text) from public, anon, authenticated;
revoke all on function public.get_teller_token(text) from public, anon, authenticated;
revoke all on function public.get_cron_secret() from public, anon, authenticated;
revoke all on function public.teller_tokens_cleanup() from public, anon, authenticated;
revoke all on function public.transactions_assign_category() from public, anon, authenticated;
revoke all on function public.is_household_member(uuid) from public, anon;
grant execute on function public.store_teller_token(text, text) to service_role;
grant execute on function public.get_teller_token(text) to service_role;
grant execute on function public.get_cron_secret() to service_role;
grant execute on function public.is_household_member(uuid) to authenticated;
