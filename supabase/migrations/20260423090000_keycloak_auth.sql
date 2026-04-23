-- Keycloak auth + role modell bevezetés
-- Futtatás az init migration után.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'editor', 'viewer');
  end if;
end $$;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  keycloak_sub text not null unique,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_memberships (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_group_memberships_user on public.group_memberships (user_id);
create index if not exists idx_group_memberships_group on public.group_memberships (group_id);

alter table public.user_profiles enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_calendar_state enable row level security;

drop policy if exists "organizations_select_public" on public.organizations;
drop policy if exists "groups_select_public" on public.groups;
drop policy if exists "group_calendar_state_select" on public.group_calendar_state;
drop policy if exists "group_calendar_state_insert" on public.group_calendar_state;
drop policy if exists "group_calendar_state_update" on public.group_calendar_state;

revoke all on public.organizations from anon, authenticated;
revoke all on public.groups from anon, authenticated;
revoke all on public.group_calendar_state from anon, authenticated;
revoke all on public.user_profiles from anon, authenticated;
revoke all on public.group_memberships from anon, authenticated;

-- Demo admin mapping (ezt cseréld le a valódi Keycloak sub értékre telepítés után).
insert into public.user_profiles (id, keycloak_sub, email, display_name)
values (
  'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03',
  'demo-admin-sub',
  'admin@example.com',
  'Demo Admin'
)
on conflict (keycloak_sub) do nothing;

insert into public.group_memberships (group_id, user_id, role)
values (
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
  'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03',
  'admin'
)
on conflict (group_id, user_id) do update set role = excluded.role;
