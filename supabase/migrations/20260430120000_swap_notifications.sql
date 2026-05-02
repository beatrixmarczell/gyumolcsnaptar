-- In-app értesítések (csere események, később opcionálisan gyümölcs emlékeztető).
-- Csak service role érheti el (Edge Function); anon tiltva.

create table if not exists public.swap_notifications (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  request_id uuid null references public.swap_requests (id) on delete cascade,
  offer_id uuid null references public.swap_offers (id) on delete set null,
  event_type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_swap_notifications_user_created
  on public.swap_notifications (user_id, created_at desc);

create index if not exists idx_swap_notifications_user_unread
  on public.swap_notifications (user_id, read_at)
  where read_at is null;

alter table public.swap_notifications enable row level security;

revoke all on public.swap_notifications from anon, authenticated;
