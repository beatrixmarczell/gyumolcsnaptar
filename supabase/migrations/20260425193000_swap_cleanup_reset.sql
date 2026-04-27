-- Swap workflow cleanup/reset migration
-- Scope: swap domain only (requests/offers/events/parent-child links), no calendar/auth/global data wipe.

-- 1) Align legacy column names in case older schema variants exist.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'swap_requests' and column_name = 'requester_parent_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'swap_requests' and column_name = 'requester_user_id'
  ) then
    alter table public.swap_requests rename column requester_parent_id to requester_user_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'swap_requests' and column_name = 'date_key'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'swap_requests' and column_name = 'requester_date_key'
  ) then
    alter table public.swap_requests rename column date_key to requester_date_key;
  end if;
end $$;

-- 2) Drop legacy columns that do not belong to V3 schema (if present).
alter table if exists public.swap_requests drop column if exists child_id;
alter table if exists public.swap_requests drop column if exists parent_id;
alter table if exists public.swap_requests drop column if exists date;

alter table if exists public.swap_offers drop column if exists child_id;
alter table if exists public.swap_offers drop column if exists parent_id;
alter table if exists public.swap_offers drop column if exists date_key;
alter table if exists public.swap_offers drop column if exists request_parent_id;

-- 3) Hard cleanup: remove all swap workflow data.
truncate table public.swap_events restart identity cascade;
truncate table public.swap_offers restart identity cascade;
truncate table public.swap_requests restart identity cascade;
truncate table public.parent_child_links restart identity cascade;

-- 4) Re-seed minimal parent-child mapping for demo/admin.
insert into public.parent_child_links (group_id, user_id, child_name)
values
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03', 'Petrilla Ádám'),
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03', 'Baló Olívia')
on conflict (group_id, user_id, child_name) do nothing;
