-- Places you never want in the budget (e.g. DraftKings): every transaction
-- from them, past and future, is excluded.
create table if not exists public.excluded_payees (
  household_id uuid not null references public.households(id) on delete cascade,
  payee_key text not null check (char_length(payee_key) between 1 and 200),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (household_id, payee_key)
);
alter table public.excluded_payees enable row level security;
create policy "members read excluded payees" on public.excluded_payees
  for select using (public.is_household_member(household_id));
grant select on public.excluded_payees to authenticated;
grant select on public.excluded_payees to service_role;

-- New transactions from an excluded place arrive excluded. (Runs after the
-- category trigger and before bill linking, which skips excluded rows.)
create or replace function public.transactions_excluded_payee()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if exists (
    select 1 from public.excluded_payees e
    where e.household_id = new.household_id
      and e.payee_key = public.payee_key(new.merchant, new.description)
  ) then
    new.excluded := true;
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_excluded_payee on public.transactions;
create trigger transactions_excluded_payee before insert on public.transactions
  for each row execute function public.transactions_excluded_payee();

-- Exclude every transaction from the same place as this one. Returns how many.
create or replace function public.exclude_payee(p_transaction_id text)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  t record;
  k text;
  n integer;
begin
  select household_id, merchant, description into t from public.transactions where id = p_transaction_id;
  if t is null or not public.is_household_member(t.household_id) then
    raise exception 'Transaction not found';
  end if;
  k := public.payee_key(t.merchant, t.description);
  if coalesce(k, '') = '' then raise exception 'This transaction has no place to match'; end if;
  insert into public.excluded_payees (household_id, payee_key, name)
  values (t.household_id, k, left(coalesce(nullif(trim(t.merchant), ''), t.description), 120))
  on conflict (household_id, payee_key) do nothing;
  update public.transactions set excluded = true
  where household_id = t.household_id and not excluded
    and public.payee_key(merchant, description) = k;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Undo: count that place in the budget again.
create or replace function public.include_payee(p_household uuid, p_payee_key text)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  if not public.is_household_member(p_household) then raise exception 'Not allowed'; end if;
  delete from public.excluded_payees where household_id = p_household and payee_key = p_payee_key;
  update public.transactions set excluded = false
  where household_id = p_household and excluded
    and public.payee_key(merchant, description) = p_payee_key;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.exclude_payee(text) from public, anon;
revoke all on function public.include_payee(uuid, text) from public, anon;
grant execute on function public.exclude_payee(text) to authenticated;
grant execute on function public.include_payee(uuid, text) to authenticated;
revoke all on function public.transactions_excluded_payee() from public, anon, authenticated;
