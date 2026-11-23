-- Security fix: remove table privileges that bypass Row Level Security.
--
-- Supabase's default privileges had granted TRUNCATE, TRIGGER and REFERENCES
-- on public tables to the API roles. TRUNCATE ignores RLS (it empties a whole
-- table, every household). The REST API can't issue it, but these privileges
-- have no use for the app, so they're removed, now and for future tables.

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

-- Helper functions nobody needs to call directly.
revoke all on function public.default_expense_type(text[]) from public, anon, authenticated;
revoke all on function public.categories_set_expense_type() from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
