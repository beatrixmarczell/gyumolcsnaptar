-- Purge all swap workflow data (requests/offers/events) after testing.

truncate table public.swap_events restart identity cascade;
truncate table public.swap_offers restart identity cascade;
truncate table public.swap_requests restart identity cascade;
