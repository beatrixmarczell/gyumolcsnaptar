-- Keycloak JWT `sub` egyeztetése a teszt szülő seed UUID-jeivel.
-- Idempotens: ha a szülő már belépett (gateway létrehozta a profilt a valódi `keycloak_sub`-bal),
-- nem próbál duplikált sort beszúrni – csak átirányítja a membership/link FK-kat és törli a seed sort.
--
-- Lokális dev (kcadm 2026-04-30):
-- szulo1 0212cd31-8f6a-418e-aee4-d7cdb53de133
-- szulo2 b74a22ad-1e12-4029-83bf-3babb3163f90
-- szulo3 86df4e5b-c14e-4c40-9b34-d499d4ed613b
-- szulo4 fa3736c2-447d-473d-82a8-7e2980f6a2d3

create or replace function public._realign_szulo_profile(
  p_seed_id uuid,
  p_kc_sub text
) returns void
language plpgsql
as $$
declare
  v_target_id uuid;
  v_seed_exists boolean;
  v_kc_user_id uuid;
begin
  v_kc_user_id := p_kc_sub::uuid;

  select id into v_target_id
  from public.user_profiles
  where keycloak_sub = p_kc_sub
  order by updated_at desc nulls last
  limit 1;

  select exists (
    select 1 from public.user_profiles where id = p_seed_id
  ) into v_seed_exists;

  if v_target_id is not null then
    if v_seed_exists and v_target_id <> p_seed_id then
      update public.group_memberships
      set user_id = v_target_id
      where user_id = p_seed_id
        and not exists (
          select 1
          from public.group_memberships gm2
          where gm2.group_id = group_memberships.group_id
            and gm2.user_id = v_target_id
        );

      delete from public.group_memberships where user_id = p_seed_id;

      update public.parent_child_links
      set user_id = v_target_id
      where user_id = p_seed_id
        and not exists (
          select 1
          from public.parent_child_links pcl2
          where pcl2.group_id = parent_child_links.group_id
            and pcl2.user_id = v_target_id
            and pcl2.child_name = parent_child_links.child_name
        );

      delete from public.parent_child_links where user_id = p_seed_id;

      update public.swap_requests set requester_user_id = v_target_id where requester_user_id = p_seed_id;
      update public.swap_offers set offer_user_id = v_target_id where offer_user_id = p_seed_id;
      update public.swap_events set actor_user_id = v_target_id where actor_user_id = p_seed_id;
      update public.swap_notifications set user_id = v_target_id where user_id = p_seed_id;

      delete from public.user_profiles where id = p_seed_id;
    end if;
    return;
  end if;

  if not v_seed_exists then
    return;
  end if;

  insert into public.user_profiles (id, keycloak_sub, email, display_name, updated_at)
  select v_kc_user_id, p_kc_sub, email, display_name, now()
  from public.user_profiles
  where id = p_seed_id;

  update public.group_memberships set user_id = v_kc_user_id where user_id = p_seed_id;
  update public.parent_child_links set user_id = v_kc_user_id where user_id = p_seed_id;
  update public.swap_requests set requester_user_id = v_kc_user_id where requester_user_id = p_seed_id;
  update public.swap_offers set offer_user_id = v_kc_user_id where offer_user_id = p_seed_id;
  update public.swap_events set actor_user_id = v_kc_user_id where actor_user_id = p_seed_id;
  update public.swap_notifications set user_id = v_kc_user_id where user_id = p_seed_id;
  delete from public.user_profiles where id = p_seed_id;
end;
$$;

do $$
begin
  perform public._realign_szulo_profile(
    '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01'::uuid,
    '0212cd31-8f6a-418e-aee4-d7cdb53de133'
  );
  perform public._realign_szulo_profile(
    '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02'::uuid,
    'b74a22ad-1e12-4029-83bf-3babb3163f90'
  );
  perform public._realign_szulo_profile(
    '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03'::uuid,
    '86df4e5b-c14e-4c40-9b34-d499d4ed613b'
  );
  perform public._realign_szulo_profile(
    '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04'::uuid,
    'fa3736c2-447d-473d-82a8-7e2980f6a2d3'
  );
end $$;

drop function if exists public._realign_szulo_profile(uuid, text);
