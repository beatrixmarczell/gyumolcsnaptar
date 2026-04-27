-- Fix enum casting in apply_swap_offer and add request withdraw RPC.

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
  set status = case when id = p_offer_id then 'accepted'::public.swap_offer_status else 'auto_rejected'::public.swap_offer_status end,
      updated_at = now()
  where request_id = p_request_id
    and status = 'pending';

  update public.swap_requests
  set status = 'resolved'::public.swap_request_status,
      resolved_offer_id = p_offer_id,
      updated_at = now()
  where id = p_request_id;

  return v_payload;
end;
$$;

create or replace function public.withdraw_swap_request(
  p_group_id uuid,
  p_request_id uuid
) returns void
language plpgsql
security definer
as $$
begin
  update public.swap_requests
  set status = 'withdrawn'::public.swap_request_status,
      updated_at = now()
  where id = p_request_id
    and group_id = p_group_id
    and status = 'requested';

  update public.swap_offers
  set status = 'rejected'::public.swap_offer_status,
      updated_at = now()
  where request_id = p_request_id
    and status = 'pending';
end;
$$;
