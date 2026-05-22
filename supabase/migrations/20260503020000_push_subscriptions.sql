-- Web Push feliratkozások tárolása (VAPID alapú push notifikációhoz).
-- Egy user több eszközről is feliratkozhat (pl. telefon + laptop) → unique(user_id, endpoint).
-- Csak service role érheti el; az Edge Function kezeli az upsert/delete-et.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;
