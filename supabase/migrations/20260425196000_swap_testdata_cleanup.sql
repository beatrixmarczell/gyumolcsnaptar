-- Cleanup temporary/garbled swap test data.
-- Keeps schema intact; clears only swap workflow records.

truncate table public.swap_events restart identity cascade;
truncate table public.swap_offers restart identity cascade;
truncate table public.swap_requests restart identity cascade;
