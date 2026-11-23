-- Explicit table permissions. Newer Supabase projects don't grant the API
-- roles access to new tables automatically, so every privilege the app needs
-- is listed here. Row Level Security still decides WHICH rows each user sees;
-- these grants decide WHAT they can do at all.
--
--  authenticated: signed-in app users. Read their household's data and edit
--                 only the user-owned fields.
--  service_role:  Edge Functions. Full access (it bypasses RLS).
--  anon:          signed-out visitors. No table access.

grant usage on schema public to anon, authenticated, service_role;

grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;

grant select on public.household_members to authenticated;

grant select, insert, update, delete on public.categories to authenticated;

grant select on public.bank_items to authenticated;

grant select on public.accounts to authenticated;
grant update (hidden, name) on public.accounts to authenticated;

grant select on public.transactions to authenticated;
grant update (category_id, notes, excluded) on public.transactions to authenticated;

-- item_tokens: deliberately no grants for authenticated or anon.

grant select, insert, update, delete on
  public.households,
  public.household_members,
  public.categories,
  public.bank_items,
  public.item_tokens,
  public.accounts,
  public.transactions
to service_role;

revoke all on all tables in schema public from anon;
