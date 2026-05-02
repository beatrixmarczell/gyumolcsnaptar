-- Négy teszt szülő: Keycloak `users[].id` = `keycloak_sub` = `user_profiles.id` (JWT `sub`).
-- Demo csoport: b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02 (20260215120000_init.sql).
-- Gyerekek: szulo1 → Marczell Zsombor Dániel; szulo2–4: névsor ABC 2–4.

insert into public.user_profiles (id, keycloak_sub, email, display_name, updated_at)
values
  (
    '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01',
    '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01',
    'szulo1@example.com',
    'Teszt Szülő 1',
    now()
  ),
  (
    '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02',
    '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02',
    'szulo2@example.com',
    'Teszt Szülő 2',
    now()
  ),
  (
    '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03',
    '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03',
    'szulo3@example.com',
    'Teszt Szülő 3',
    now()
  ),
  (
    '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04',
    '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04',
    'szulo4@example.com',
    'Teszt Szülő 4',
    now()
  )
on conflict (keycloak_sub) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  updated_at = now();

insert into public.group_memberships (group_id, user_id, role)
values
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01', 'editor'),
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02', 'editor'),
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03', 'editor'),
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04', 'editor')
on conflict (group_id, user_id) do update
set role = excluded.role;

insert into public.parent_child_links (group_id, user_id, child_name)
values
  (
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    '2d8f9c2e-1001-4f0a-9b2a-7c3e9f1a2b01',
    'Marczell Zsombor Dániel'
  ),
  (
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    '2d8f9c2e-1002-4f0a-9b2a-7c3e9f1a2b02',
    'Baló Olívia'
  ),
  (
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    '2d8f9c2e-1003-4f0a-9b2a-7c3e9f1a2b03',
    'Burik Bendegúz'
  ),
  (
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    '2d8f9c2e-1004-4f0a-9b2a-7c3e9f1a2b04',
    'Czakó Adél Luca'
  )
on conflict (group_id, user_id, child_name) do nothing;
