-- Indexes on foreign keys (suggested by the Supabase performance advisor).
create index if not exists accounts_item_id on public.accounts(item_id);
create index if not exists accounts_household_id on public.accounts(household_id);
create index if not exists bank_items_household_id on public.bank_items(household_id);
create index if not exists bank_items_created_by on public.bank_items(created_by);
create index if not exists transactions_category_id on public.transactions(category_id);
