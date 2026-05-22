-- ============================================================
-- Gyümölcsnaptár – Értesítési rendszer migrációk
-- Supabase SQL Editorban futtatandó (egyszerre)
-- Keletkezés: 2026-05-03
-- ============================================================

-- 1. Értesítési preferencia oszlopok a user_profiles táblán
alter table public.user_profiles
  add column if not exists notification_email text,
  add column if not exists notify_email_calendar boolean not null default true,
  add column if not exists notify_push_calendar  boolean not null default true,
  add column if not exists notify_email_swap     boolean not null default true,
  add column if not exists notify_push_swap      boolean not null default true;

-- 2. Web Push feliratkozások táblája
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_subscriptions'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'push_subscriptions' and column_name = 'user_id'
  ) then
    drop table public.push_subscriptions;
  end if;
end $$;

create table if not exists public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.user_profiles(id) on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,
  auth_key   text        not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;
