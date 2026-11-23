-- Switch the bank provider from Teller to Plaid, and harden security.
--
-- Written without DROP/DELETE so it applies cleanly on a live project: the
-- old (empty) Teller token table is moved to a private `legacy` schema rather
-- than dropped. Once you're happy, you can remove it with:
--   drop schema legacy cascade;
--
-- Security changes:
--  * Plaid access tokens are encrypted with Supabase Vault. item_tokens keeps
--    only a pointer; decrypting requires get_item_token(), which only the
--    service role (Edge Functions) can run.
--  * Removing a bank goes through the plaid-disconnect Edge Function, which
--    revokes access at Plaid first. Members can't delete bank rows directly.
--  * The daily sync authenticates with a random secret generated here and
--    kept in Vault, so nobody ever handles it.
--  * Members may only rename the household (not change its invite code).
--  * Manual "Sync now" is throttled.

-- ---------------------------------------------------------------------------
-- Retire the Teller token table
-- ---------------------------------------------------------------------------
create schema if not exists legacy;
revoke all on schema legacy from public, anon, authenticated;
alter table public.teller_tokens set schema legacy;

-- ---------------------------------------------------------------------------
-- Bank connections (Plaid "Items")
-- ---------------------------------------------------------------------------
alter table public.teller_enrollments rename to bank_items;
comment on table public.bank_items is 'One row per bank login (Plaid Item). id = Plaid item_id.';
alter table public.bank_items add column institution_id text;
alter table public.bank_items add column sync_cursor text;
alter policy "members read enrollments" on public.bank_items rename to "members read bank items";
-- Neutralize the old direct-delete policy: removal goes through the server.
alter policy "members remove enrollments" on public.bank_items using (false);
alter policy "members remove enrollments" on public.bank_items rename to "removal via server only";
revoke delete on public.bank_items from anon, authenticated;

alter table public.accounts rename column enrollment_id to item_id;
alter table public.transactions rename column teller_category to category_detailed;
alter table public.transactions add column category_primary text;
alter table public.categories rename column teller_categories to provider_categories;

-- ---------------------------------------------------------------------------
-- Category mapping for Plaid's personal_finance_category
-- ---------------------------------------------------------------------------
-- Detailed categories are matched first (e.g. FOOD_AND_DRINK_GROCERIES ->
-- Groceries), then primary ones (FOOD_AND_DRINK -> Dining). Transfers between
-- your own accounts and credit card payments are excluded from budgets
-- automatically.
create or replace function public.transactions_assign_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is null and new.category_detailed is not null then
    select c.id into new.category_id
    from public.categories c
    where c.household_id = new.household_id
      and new.category_detailed = any (c.provider_categories)
    order by c.sort_order
    limit 1;
  end if;
  if new.category_id is null and new.category_primary is not null then
    select c.id into new.category_id
    from public.categories c
    where c.household_id = new.household_id
      and new.category_primary = any (c.provider_categories)
    order by c.sort_order
    limit 1;
  end if;
  if new.category_primary in ('TRANSFER_IN', 'TRANSFER_OUT')
     or new.category_detailed = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' then
    new.excluded := true;
  end if;
  return new;
end;
$$;

create or replace function public.seed_default_categories(hid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (household_id, name, color, is_income, provider_categories, sort_order) values
    (hid, 'Income',              '#16A34A', true,  '{INCOME}', 0),
    (hid, 'Groceries',           '#22C55E', false, '{FOOD_AND_DRINK_GROCERIES}', 1),
    (hid, 'Dining & Drinks',     '#F97316', false, '{FOOD_AND_DRINK}', 2),
    (hid, 'Rent & Home',         '#0EA5E9', false, '{RENT_AND_UTILITIES_RENT,HOME_IMPROVEMENT}', 3),
    (hid, 'Utilities & Phone',   '#6366F1', false, '{RENT_AND_UTILITIES}', 4),
    (hid, 'Transportation',      '#EAB308', false, '{TRANSPORTATION}', 5),
    (hid, 'Travel',              '#06B6D4', false, '{TRAVEL}', 6),
    (hid, 'Shopping',            '#EC4899', false, '{GENERAL_MERCHANDISE}', 7),
    (hid, 'Entertainment',       '#A855F7', false, '{ENTERTAINMENT}', 8),
    (hid, 'Health',              '#EF4444', false, '{MEDICAL}', 9),
    (hid, 'Personal Care',       '#F472B6', false, '{PERSONAL_CARE}', 10),
    (hid, 'Insurance',           '#64748B', false, '{GENERAL_SERVICES_INSURANCE}', 11),
    (hid, 'Education',           '#14B8A6', false, '{GENERAL_SERVICES_EDUCATION}', 12),
    (hid, 'Services & Subscriptions', '#8B5CF6', false, '{GENERAL_SERVICES}', 13),
    (hid, 'Giving',              '#F43F5E', false, '{GOVERNMENT_AND_NON_PROFIT_DONATIONS}', 14),
    (hid, 'Taxes',               '#78716C', false, '{GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT}', 15),
    (hid, 'Loans',               '#475569', false, '{LOAN_PAYMENTS}', 16),
    (hid, 'Bank Fees',           '#B45309', false, '{BANK_FEES}', 17),
    (hid, 'Transfers',           '#94A3B8', false, '{TRANSFER_IN,TRANSFER_OUT}', 18),
    (hid, 'Other',               '#9CA3AF', false, '{OTHER,GOVERNMENT_AND_NON_PROFIT}', 99)
  on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Encrypted Plaid access tokens
-- ---------------------------------------------------------------------------
create table public.item_tokens (
  item_id text primary key references public.bank_items(id) on delete cascade,
  secret_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.item_tokens enable row level security;  -- no policies: service role only
revoke all on public.item_tokens from anon, authenticated;

create or replace function public.store_item_token(p_item_id text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  select secret_id into sid from public.item_tokens where item_id = p_item_id;
  if sid is null then
    sid := vault.create_secret(
      p_token,
      'plaid_token_' || p_item_id || '_' || extract(epoch from clock_timestamp())::bigint,
      'Plaid access token'
    );
    insert into public.item_tokens (item_id, secret_id) values (p_item_id, sid);
  else
    perform vault.update_secret(sid, p_token);
  end if;
end;
$$;

create or replace function public.get_item_token(p_item_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
  from public.item_tokens t
  join vault.decrypted_secrets d on d.id = t.secret_id
  where t.item_id = p_item_id;
$$;

-- When a bank is removed, wipe its token from Vault.
create or replace function public.item_tokens_wipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform vault.update_secret(old.secret_id, 'revoked', 'revoked_' || old.secret_id::text, 'Revoked Plaid token');
  return old;
end;
$$;

create trigger item_tokens_wipe
after delete on public.item_tokens
for each row execute function public.item_tokens_wipe();

-- ---------------------------------------------------------------------------
-- Secret for the scheduled sync (generated here, never leaves the database
-- except to authenticate the cron call).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret for the scheduled plaid-sync call'
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
-- Households: throttle column, and members may only change the name.
-- ---------------------------------------------------------------------------
alter table public.households add column last_manual_sync_at timestamptz;
revoke update on public.households from anon, authenticated;
grant update (name) on public.households to authenticated;

-- ---------------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------------
revoke all on function public.store_item_token(text, text) from public, anon, authenticated;
revoke all on function public.get_item_token(text) from public, anon, authenticated;
revoke all on function public.get_cron_secret() from public, anon, authenticated;
revoke all on function public.item_tokens_wipe() from public, anon, authenticated;
revoke all on function public.transactions_assign_category() from public, anon, authenticated;
revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;
revoke all on function public.is_household_member(uuid) from public, anon;
grant execute on function public.store_item_token(text, text) to service_role;
grant execute on function public.get_item_token(text) to service_role;
grant execute on function public.get_cron_secret() to service_role;
grant execute on function public.is_household_member(uuid) to authenticated;
