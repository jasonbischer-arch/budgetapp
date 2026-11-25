-- The market-prices Edge Function (service role) writes the closes.
grant select, insert, update on public.market_prices to service_role;
