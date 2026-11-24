-- Custom categories: an emoji, and sane names.
alter table public.categories add column if not exists icon text check (icon is null or char_length(icon) between 1 and 16);
alter table public.categories add constraint categories_name_length check (char_length(btrim(name)) between 1 and 40) not valid;
alter table public.categories validate constraint categories_name_length;
grant insert (icon), update (icon) on public.categories to authenticated;

-- Child care is a fixed expense by default (daycare, after-school).
create or replace function public.default_expense_type(p text[])
returns text language sql immutable set search_path to '' as $$
  select case
    when p && '{RENT_AND_UTILITIES_RENT,RENT_AND_UTILITIES,GENERAL_SERVICES_INSURANCE,GENERAL_SERVICES_EDUCATION,GENERAL_SERVICES_CHILDCARE,GENERAL_SERVICES,GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT,LOAN_PAYMENTS}'::text[]
      then 'fixed'
    else 'variable'
  end;
$$;

-- Only guess fixed/variable for built-in categories (matched to bank
-- categories). A category you create keeps the type you chose.
create or replace function public.categories_set_expense_type()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.kind = 'expense' and tg_op = 'INSERT' and cardinality(new.provider_categories) > 0 then
    new.expense_type := public.default_expense_type(new.provider_categories);
  end if;
  return new;
end;
$$;

-- New households get Child Care.
create or replace function public.seed_default_categories(hid uuid)
returns void language sql security definer set search_path to '' as $$
  insert into public.categories (household_id, name, color, kind, is_income, provider_categories, sort_order) values
    (hid, 'Income',              '#16A34A', 'income',  true,  '{INCOME}', 0),
    (hid, 'Groceries',           '#22C55E', 'expense', false, '{FOOD_AND_DRINK_GROCERIES}', 1),
    (hid, 'Dining & Drinks',     '#F97316', 'expense', false, '{FOOD_AND_DRINK}', 2),
    (hid, 'Rent & Home',         '#0EA5E9', 'expense', false, '{RENT_AND_UTILITIES_RENT,HOME_IMPROVEMENT}', 3),
    (hid, 'Utilities & Phone',   '#6366F1', 'expense', false, '{RENT_AND_UTILITIES}', 4),
    (hid, 'Transportation',      '#EAB308', 'expense', false, '{TRANSPORTATION}', 5),
    (hid, 'Travel',              '#06B6D4', 'expense', false, '{TRAVEL}', 6),
    (hid, 'Shopping',            '#EC4899', 'expense', false, '{GENERAL_MERCHANDISE}', 7),
    (hid, 'Entertainment',       '#A855F7', 'expense', false, '{ENTERTAINMENT}', 8),
    (hid, 'Health',              '#EF4444', 'expense', false, '{MEDICAL}', 9),
    (hid, 'Personal Care',       '#F472B6', 'expense', false, '{PERSONAL_CARE}', 10),
    (hid, 'Insurance',           '#64748B', 'expense', false, '{GENERAL_SERVICES_INSURANCE}', 11),
    (hid, 'Education',           '#14B8A6', 'expense', false, '{GENERAL_SERVICES_EDUCATION}', 12),
    (hid, 'Child Care',          '#F59E0B', 'expense', false, '{GENERAL_SERVICES_CHILDCARE}', 12),
    (hid, 'Services & Subscriptions', '#8B5CF6', 'expense', false, '{GENERAL_SERVICES}', 13),
    (hid, 'Giving',              '#F43F5E', 'expense', false, '{GOVERNMENT_AND_NON_PROFIT_DONATIONS}', 14),
    (hid, 'Taxes',               '#78716C', 'expense', false, '{GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT}', 15),
    (hid, 'Loans',               '#475569', 'expense', false, '{LOAN_PAYMENTS}', 16),
    (hid, 'Savings & Investing', '#0D9488', 'savings', false, '{TRANSFER_OUT_SAVINGS,TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS}', 17),
    (hid, 'Bank Fees',           '#B45309', 'expense', false, '{BANK_FEES}', 18),
    (hid, 'Transfers',           '#94A3B8', 'transfer', false, '{TRANSFER_IN,TRANSFER_OUT}', 19),
    (hid, 'Other',               '#9CA3AF', 'expense', false, '{OTHER,GOVERNMENT_AND_NON_PROFIT}', 99)
  on conflict do nothing;
$$;

-- Existing households get it too.
insert into public.categories (household_id, name, color, kind, is_income, provider_categories, sort_order, icon)
select h.id, 'Child Care', '#F59E0B', 'expense', false, '{GENERAL_SERVICES_CHILDCARE}', 12, '🧸'
from public.households h
on conflict (household_id, name) do nothing;

-- Move child care transactions that were filed automatically under
-- Services & Subscriptions (ones you filed yourself are left alone).
update public.transactions t
set category_id = cc.id
from public.categories cc, public.categories svc
where t.category_detailed = 'GENERAL_SERVICES_CHILDCARE'
  and cc.household_id = t.household_id and cc.name = 'Child Care'
  and svc.id = t.category_id and svc.provider_categories @> '{GENERAL_SERVICES}';

-- Bills detected from those payments follow.
update public.bills b
set category_id = cc.id
from public.categories cc, public.categories svc
where cc.household_id = b.household_id and cc.name = 'Child Care'
  and svc.id = b.category_id and svc.provider_categories @> '{GENERAL_SERVICES}'
  and b.detection_key is not null
  and exists (
    select 1 from public.transactions t
    where t.household_id = b.household_id and t.category_id = cc.id
      and upper(coalesce(t.merchant, t.description)) like '%' || split_part(b.detection_key, ' ', 1) || '%'
  );
