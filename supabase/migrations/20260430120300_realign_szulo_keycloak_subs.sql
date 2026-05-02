-- Egyszer futtatható: Keycloak JWT `sub` egyeztetése a teszt szülő seed UUID-jeivel.
-- Csak akkor maradjon a történetben, ha a Keycloak felhasználók id-ja NEM a `20260430120200` seed `2d8f9c2e-*` értéke
-- (pl. már létező KC user, vagy kcadm nélküli véletlen id).
--
-- Lokális dev (kcadm 2026-04-30):
-- szulo1 0212cd31-8f6a-418e-aee4-d7cdb53de133
-- szulo2 b74a22ad-1e12-4029-83bf-3babb3163f90
-- szulo3 86df4e5b-c14e-4c40-9b34-d499d4ed613b
-- szulo4 fa3736c2-447d-473d-82a8-7e2980f6a2d3
--
-- Más környezeten cseréld ezeket a KC admin / kcadm által mutatott user id-kra.

do $$
begin
  -- szulo1
  insert into public.user_profiles (id, keycloak_sub, email, display_name, updated_at)
  select '0212cd31-8f6a-418e-aee4-d7cdb53de133'::uuid, '0212cd31-8f6a-418e-aee4-d7cdb53de133'::uuid, email, display_name, now()
  from public.user_profiles where id = '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01'::uuid;
  update public.group_memberships set user_id = '0212cd31-8f6a-418e-aee4-d7cdb53de133' where user_id = '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01';
  update public.parent_child_links set user_id = '0212cd31-8f6a-418e-aee4-d7cdb53de133' where user_id = '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01';
  delete from public.user_profiles where id = '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01';

  -- szulo2
  insert into public.user_profiles (id, keycloak_sub, email, display_name, updated_at)
  select 'b74a22ad-1e12-4029-83bf-3babb3163f90'::uuid, 'b74a22ad-1e12-4029-83bf-3babb3163f90'::uuid, email, display_name, now()
  from public.user_profiles where id = '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02'::uuid;
  update public.group_memberships set user_id = 'b74a22ad-1e12-4029-83bf-3babb3163f90' where user_id = '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02';
  update public.parent_child_links set user_id = 'b74a22ad-1e12-4029-83bf-3babb3163f90' where user_id = '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02';
  delete from public.user_profiles where id = '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02';

  -- szulo3
  insert into public.user_profiles (id, keycloak_sub, email, display_name, updated_at)
  select '86df4e5b-c14e-4c40-9b34-d499d4ed613b'::uuid, '86df4e5b-c14e-4c40-9b34-d499d4ed613b'::uuid, email, display_name, now()
  from public.user_profiles where id = '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03'::uuid;
  update public.group_memberships set user_id = '86df4e5b-c14e-4c40-9b34-d499d4ed613b' where user_id = '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03';
  update public.parent_child_links set user_id = '86df4e5b-c14e-4c40-9b34-d499d4ed613b' where user_id = '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03';
  delete from public.user_profiles where id = '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03';

  -- szulo4
  insert into public.user_profiles (id, keycloak_sub, email, display_name, updated_at)
  select 'fa3736c2-447d-473d-82a8-7e2980f6a2d3'::uuid, 'fa3736c2-447d-473d-82a8-7e2980f6a2d3'::uuid, email, display_name, now()
  from public.user_profiles where id = '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04'::uuid;
  update public.group_memberships set user_id = 'fa3736c2-447d-473d-82a8-7e2980f6a2d3' where user_id = '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04';
  update public.parent_child_links set user_id = 'fa3736c2-447d-473d-82a8-7e2980f6a2d3' where user_id = '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04';
  delete from public.user_profiles where id = '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04';
end $$;
