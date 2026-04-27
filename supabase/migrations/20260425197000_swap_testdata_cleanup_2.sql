-- Cleanup smoke-test records after backend verification.

truncate table public.swap_events restart identity cascade;
truncate table public.swap_offers restart identity cascade;
truncate table public.swap_requests restart identity cascade;
