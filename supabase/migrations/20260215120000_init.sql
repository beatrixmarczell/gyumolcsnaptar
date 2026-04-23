-- Gyümölcsnaptár: alap séma (több ovi / csoport később bővíthető)
-- Futtatás: Supabase → SQL Editor → New query → beillesztés → Run
-- vagy: supabase db push (ha van Supabase CLI)

create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text,
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.group_calendar_state (
  group_id uuid primary key references public.groups (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Demo ovi + demo csoport (a VITE_DEFAULT_GROUP_ID ehhez a csoporthoz tartozik)
insert into public.organizations (id, name)
values ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01', 'Demo óvoda')
on conflict (id) do nothing;

insert into public.groups (id, organization_id, name, slug)
values (
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
  'Demo csoport',
  'demo'
)
on conflict (id) do nothing;

-- RLS: MVP – nyilvános olvasás/írás az anon kulccsal (a kulcs a frontendben is benne van).
-- Később: bejelentkezés + szigorúbb szabályok.
alter table public.organizations enable row level security;
alter table public.groups enable row level security;
alter table public.group_calendar_state enable row level security;

create policy "organizations_select_public" on public.organizations
  for select using (true);

create policy "groups_select_public" on public.groups
  for select using (true);

create policy "group_calendar_state_select" on public.group_calendar_state
  for select using (true);

create policy "group_calendar_state_insert" on public.group_calendar_state
  for insert with check (true);

create policy "group_calendar_state_update" on public.group_calendar_state
  for update using (true) with check (true);

-- Értesítések: opcionális, ha a kliens figyelné a változást
-- (alter publication ... realtime add table ...)

comment on table public.group_calendar_state is
  'Egy csoport naptárának JSON állapota (séma: schemaVersion=1 a React app).';
