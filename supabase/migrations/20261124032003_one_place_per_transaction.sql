-- Every transaction counts in exactly one place.
--
-- 1. A payment to a bill's payee is linked to that bill (transactions.bill_id)
--    and counts as the bill, not also in its spending category.
-- 2. A pending charge that has posted is ignored (the posted copy counts).
-- 3. A bank account connected twice counts only once (the first connection).

-- Who was paid, normalized: same rules as payerKey() in the Edge Functions
-- and payeeKey() in the app (e.g. "ALLY ALLY PAYMT WEB ID 98" -> "ALLY ALLY PAYMT").
create or replace function public.payee_key(p_merchant text, p_description text)
returns text language sql immutable parallel safe set search_path to '' as $$
  select coalesce(string_agg(w, ' ' order by i), '')
  from (
    select w, i
    from unnest(regexp_split_to_array(btrim(regexp_replace(
           upper(coalesce(nullif(btrim(p_merchant), ''), p_description, '')), '[^A-Z ]+', ' ', 'g')), '\s+'))
         with ordinality as x(w, i)
    where length(w) >= 2 and w <> all (array[
      'ACH','PPD','CCD','ID','DES','INDN','CO','DIRECT','DIR','DEP','DEPOSIT','CREDIT','ELECTRONIC','ELEC',
      'TRANSFER','WEB','ONLINE','PAYMENT','PMT','FROM','THE','INC','LLC','CORP','CORPORATION','COMPANY','LTD',
      'NA','TRN','REF','ORIG','NAME','ENTRY','DESCR','SEC','IND','TRACE','EFF','DATE'])
    order by i
    limit 4
  ) s;
$$;

-- Bills: which payee they're paid to.
alter table public.bills add column if not exists match_key text check (match_key is null or char_length(match_key) <= 120);
grant insert (match_key), update (match_key) on public.bills to authenticated;

create or replace function public.bills_set_match_key()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.match_key is null or btrim(new.match_key) = '' then
    new.match_key := case
      when new.detection_key like 'ACCOUNT:%' then null
      when new.detection_key is not null then regexp_replace(new.detection_key, '#\d+$', '')
      else nullif(public.payee_key(null, new.name), '')
    end;
  else
    new.match_key := upper(btrim(new.match_key));
  end if;
  return new;
end;
$$;
create trigger bills_set_match_key before insert or update of name, detection_key, match_key on public.bills
  for each row execute function public.bills_set_match_key();
update public.bills set match_key = null;

-- One bill per payee (amount bands of one payee, like two loans at one
-- lender, are the exception), so a payment can't be counted by two bills.
create unique index if not exists bills_one_per_payee on public.bills (household_id, match_key)
  where not dismissed and match_key is not null and (detection_key is null or detection_key !~ '#\d+$');

-- The bill a payment belongs to (closest amount if a payee has several).
create or replace function public.match_bill(p_household uuid, p_key text, p_amount numeric)
returns uuid language sql stable security definer set search_path to '' as $$
  select b.id from public.bills b
  where b.household_id = p_household and not b.dismissed and p_key <> '' and b.match_key = p_key
    and (b.detection_key is null or b.detection_key !~ '#\d+$' or b.amount is null
         or abs(-p_amount - b.amount) <= 0.35 * b.amount)
  order by abs(-p_amount - coalesce(b.amount, -p_amount))
  limit 1;
$$;
revoke execute on function public.match_bill(uuid, text, numeric) from public, anon;
grant execute on function public.match_bill(uuid, text, numeric) to authenticated, service_role;

alter table public.transactions
  add column if not exists bill_id uuid references public.bills(id) on delete set null,
  add column if not exists pending_transaction_id text;
create index if not exists transactions_bill_id on public.transactions (bill_id) where bill_id is not null;
create index if not exists transactions_pending_txn on public.transactions (pending_transaction_id) where pending_transaction_id is not null;

-- New and changed transactions link to their bill automatically.
create or replace function public.transactions_link_bill()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.bill_id := case
    when new.amount < 0 and not new.excluded
      then public.match_bill(new.household_id, public.payee_key(new.merchant, new.description), new.amount)
  end;
  return new;
end;
$$;
create trigger transactions_link_bill before insert or update of merchant, description, amount, excluded
  on public.transactions for each row execute function public.transactions_link_bill();

-- When bills change, re-link that household's payments.
create or replace function public.relink_bill_payments(p_household uuid)
returns void language sql security definer set search_path to '' as $$
  update public.transactions t
  set bill_id = x.bill_id
  from (
    select id, case when amount < 0 and not excluded
      then public.match_bill(household_id, public.payee_key(merchant, description), amount) end as bill_id
    from public.transactions where household_id = p_household
  ) x
  where t.id = x.id and t.bill_id is distinct from x.bill_id;
$$;
revoke execute on function public.relink_bill_payments(uuid) from public, anon, authenticated;

create or replace function public.bills_relink()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform public.relink_bill_payments(coalesce(new.household_id, old.household_id));
  return null;
end;
$$;
create trigger bills_relink after insert or delete or update of match_key, amount, dismissed, detection_key
  on public.bills for each row execute function public.bills_relink();

-- Link everything that's already there.
select public.relink_bill_payments(id) from public.households;

-- The view every total is built from, with the duplicate guards.
create or replace view public.transaction_flows with (security_invoker = true) as
select t.id,
  t.household_id,
  t.account_id,
  t.date,
  date_trunc('month', t.date::timestamptz)::date as month,
  t.amount,
  t.category_id,
  case
    when (a.type <> all (array['depository', 'credit'])) or a.hidden then 'ignored'
    -- A pending charge that has already posted: the posted copy counts.
    when t.status = 'pending' and exists (
      select 1 from public.transactions p where p.pending_transaction_id = t.id) then 'ignored'
    -- The same account connected twice: only the first connection counts.
    when exists (
      select 1 from public.accounts a2
      join public.bank_items i2 on i2.id = a2.item_id
      join public.bank_items i1 on i1.id = a.item_id
      where a2.household_id = a.household_id and a2.id <> a.id and a2.item_id <> a.item_id
        and a2.last_four is not null and a2.last_four = a.last_four
        and a2.type = a.type and coalesce(a2.subtype, '') = coalesce(a.subtype, '')
        and a2.institution_name is not distinct from a.institution_name
        and (i2.created_at, i2.id) < (i1.created_at, i1.id)) then 'ignored'
    when t.excluded then 'excluded'
    when c.kind = 'savings' then case when t.amount < 0 then 'saved' else 'excluded' end
    when c.kind = 'transfer' then 'excluded'
    when c.kind = 'income' then 'income'
    when t.amount < 0 then 'spending'
    when c.id is null or (t.category_primary = 'OTHER' and c.provider_categories && '{OTHER}') then 'income'
    else 'refund'
  end as flow,
  t.description,
  t.merchant,
  t.category_detailed,
  t.bill_id
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id;

-- Monthly totals, split by bill so payments a bill covers aren't counted
-- again in their category.
create or replace function public.monthly_flows_by_bill(p_from date)
returns table(month date, flow text, category_id uuid, bill_id uuid, total numeric, n bigint)
language sql stable set search_path to '' as $$
  select f.month, f.flow, f.category_id, f.bill_id, sum(f.amount), count(*)
  from public.transaction_flows f
  where f.date >= p_from and f.flow not in ('ignored', 'excluded')
  group by 1, 2, 3, 4;
$$;
revoke execute on function public.monthly_flows_by_bill(date) from public, anon;
grant execute on function public.monthly_flows_by_bill(date) to authenticated;
