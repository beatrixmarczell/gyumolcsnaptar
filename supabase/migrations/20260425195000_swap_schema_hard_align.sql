-- Hard schema align for V3 swap workflow.
-- Safe now because swap data was explicitly cleaned before.

drop table if exists public.swap_events cascade;
drop table if exists public.swap_offers cascade;
drop table if exists public.swap_requests cascade;

create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  requester_user_id uuid not null references public.user_profiles (id) on delete cascade,
  requester_child_name text not null,
  requester_date_key text not null,
  note text,
  status public.swap_request_status not null default 'requested',
  resolved_offer_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_swap_request_date_key_format check (requester_date_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

create index if not exists idx_swap_requests_group_status on public.swap_requests (group_id, status);
create index if not exists idx_swap_requests_requester on public.swap_requests (requester_user_id);
create index if not exists idx_swap_requests_group_created on public.swap_requests (group_id, created_at desc);

create table public.swap_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.swap_requests (id) on delete cascade,
  offer_user_id uuid not null references public.user_profiles (id) on delete cascade,
  offer_child_name text not null,
  offer_date_key text not null,
  note text,
  status public.swap_offer_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_swap_offer_date_key_format check (offer_date_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  constraint uq_swap_offers_request_user unique (request_id, offer_user_id)
);

create index if not exists idx_swap_offers_request_status on public.swap_offers (request_id, status);
create index if not exists idx_swap_offers_user on public.swap_offers (offer_user_id);

alter table public.swap_requests
  add constraint fk_swap_requests_resolved_offer
  foreign key (resolved_offer_id)
  references public.swap_offers (id)
  on delete set null;

create table public.swap_events (
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

create index if not exists idx_swap_events_group_created on public.swap_events (group_id, created_at desc);
create index if not exists idx_swap_events_request on public.swap_events (request_id);

alter table public.swap_requests enable row level security;
alter table public.swap_offers enable row level security;
alter table public.swap_events enable row level security;

revoke all on public.swap_requests from anon, authenticated;
revoke all on public.swap_offers from anon, authenticated;
revoke all on public.swap_events from anon, authenticated;

create or replace function public.apply_swap_offer(
  p_group_id uuid,
  p_request_id uuid,
  p_offer_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_request public.swap_requests%rowtype;
  v_offer public.swap_offers%rowtype;
  v_payload jsonb;
  v_request_date_key text;
  v_offer_date_key text;
  v_request_child text;
  v_offer_child text;
  v_request_month text;
  v_offer_month text;
begin
  select * into v_request
  from public.swap_requests
  where id = p_request_id and group_id = p_group_id
  for update;

  if not found then
    raise exception 'Swap request nem található';
  end if;
  if v_request.status <> 'requested' then
    raise exception 'Swap request már nem aktív';
  end if;

  select o.* into v_offer
  from public.swap_offers o
  where o.id = p_offer_id and o.request_id = p_request_id
  for update;

  if not found then
    raise exception 'Swap offer nem található';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'Swap offer már nem pending';
  end if;

  select payload into v_payload
  from public.group_calendar_state
  where group_id = p_group_id
  for update;

  if v_payload is null then
    raise exception 'Group state payload hiányzik';
  end if;

  v_request_date_key := v_request.requester_date_key;
  v_offer_date_key := v_offer.offer_date_key;
  v_request_month := substring(v_request_date_key from 1 for 7);
  v_offer_month := substring(v_offer_date_key from 1 for 7);

  v_request_child := coalesce(v_payload #>> array['manualOverridesByMonth', v_request_month, v_request_date_key], '');
  v_offer_child := coalesce(v_payload #>> array['manualOverridesByMonth', v_offer_month, v_offer_date_key], '');

  if v_request_child = '' then
    v_request_child := v_request.requester_child_name;
  end if;
  if v_offer_child = '' then
    v_offer_child := v_offer.offer_child_name;
  end if;

  v_payload := jsonb_set(
    v_payload,
    array['manualOverridesByMonth', v_request_month, v_request_date_key],
    to_jsonb(v_offer_child),
    true
  );
  v_payload := jsonb_set(
    v_payload,
    array['manualOverridesByMonth', v_offer_month, v_offer_date_key],
    to_jsonb(v_request_child),
    true
  );

  update public.group_calendar_state
  set payload = v_payload,
      updated_at = now()
  where group_id = p_group_id;

  update public.swap_offers
  set status = case when id = p_offer_id then 'accepted' else 'auto_rejected' end,
      updated_at = now()
  where request_id = p_request_id
    and status = 'pending';

  update public.swap_requests
  set status = 'resolved',
      resolved_offer_id = p_offer_id,
      updated_at = now()
  where id = p_request_id;

  return v_payload;
end;
$$;
