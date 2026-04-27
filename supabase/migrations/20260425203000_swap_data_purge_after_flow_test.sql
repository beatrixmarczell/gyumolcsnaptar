-- Purge swap test data after end-to-end flow tests.

truncate table public.swap_events restart identity cascade;
truncate table public.swap_offers restart identity cascade;
truncate table public.swap_requests restart identity cascade;
