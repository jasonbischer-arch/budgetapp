-- Whether Plaid has been told where to send webhooks for this bank.
alter table public.bank_items add column if not exists webhook_registered boolean not null default false;
