-- Swap workflow v3 base schema.
-- Rekonstrukció: a prod DB-n a remote 20260425190000 már alkalmazva volt,
-- ezért a fájl placeholder maradt. Új projektre rebuild-eléshez idempotens
-- formában tartalmazza azt, amit a követő (193000+, 195000+) migrációk
-- felfeltételeznek: enum típusok, parent_child_links, és minimal swap_*
-- táblák (a 195000 hard align úgyis cascade drop+create-el lecseréli őket).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'swap_request_status') then
    create type public.swap_request_status as enum ('requested', 'resolved', 'withdrawn');
  end if;
  if not exists (select 1 from pg_type where typname = 'swap_offer_status') then
    create type public.swap_offer_status as enum ('pending', 'accepted', 'rejected', 'auto_rejected', 'withdrawn');
  end if;
end $$;

create table if not exists public.parent_child_links (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  child_name text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id, child_name)
);

create table if not exists public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  requester_user_id uuid not null references public.user_profiles (id) on delete cascade,
  requester_child_name text not null,
  requester_date_key text not null,
  note text,
  status public.swap_request_status not null default 'requested',
  resolved_offer_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.swap_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.swap_requests (id) on delete cascade,
  offer_user_id uuid not null references public.user_profiles (id) on delete cascade,
  offer_child_name text not null,
  offer_date_key text not null,
  note text,
  status public.swap_offer_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.swap_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  request_id uuid null references public.swap_requests (id) on delete cascade,
  offer_id uuid null references public.swap_offers (id) on delete cascade,
  actor_user_id uuid null references public.user_profiles (id) on delete set null,
  event_type text not null,
  visibility text not null default 'group',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.parent_child_links enable row level security;
alter table public.swap_requests enable row level security;
alter table public.swap_offers enable row level security;
alter table public.swap_events enable row level security;

revoke all on public.parent_child_links from anon, authenticated;
revoke all on public.swap_requests from anon, authenticated;
revoke all on public.swap_offers from anon, authenticated;
revoke all on public.swap_events from anon, authenticated;
