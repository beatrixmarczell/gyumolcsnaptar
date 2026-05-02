-- Szülő–gyerek linkek szinkronja a jelenlegi `user_profiles` sorral (e-mail szerint).
-- Megelőzi a duplikált (group_id, user_id, child_name) PK ütközést: töröl, majd beszúr.
-- Futtasd `supabase migration repair --status reverted 20260502120000` ha az előző hibás próbálkozás bent maradt a history-ban.

do $$
declare
  gid uuid := 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';
  uid1 uuid;
  uid2 uuid;
  uid3 uuid;
  uid4 uuid;
begin
  select id into uid1 from public.user_profiles where email = 'szulo1@example.com' order by updated_at desc nulls last limit 1;
  select id into uid2 from public.user_profiles where email = 'szulo2@example.com' order by updated_at desc nulls last limit 1;
  select id into uid3 from public.user_profiles where email = 'szulo3@example.com' order by updated_at desc nulls last limit 1;
  select id into uid4 from public.user_profiles where email = 'szulo4@example.com' order by updated_at desc nulls last limit 1;

  delete from public.parent_child_links where group_id = gid and child_name = 'Marczell Zsombor Dániel';
  if uid1 is not null then
    insert into public.parent_child_links (group_id, user_id, child_name) values (gid, uid1, 'Marczell Zsombor Dániel')
    on conflict (group_id, user_id, child_name) do nothing;
  end if;

  delete from public.parent_child_links where group_id = gid and child_name = 'Baló Olívia';
  if uid2 is not null then
    insert into public.parent_child_links (group_id, user_id, child_name) values (gid, uid2, 'Baló Olívia')
    on conflict (group_id, user_id, child_name) do nothing;
  end if;

  delete from public.parent_child_links where group_id = gid and child_name = 'Burik Bendegúz';
  if uid3 is not null then
    insert into public.parent_child_links (group_id, user_id, child_name) values (gid, uid3, 'Burik Bendegúz')
    on conflict (group_id, user_id, child_name) do nothing;
  end if;

  delete from public.parent_child_links where group_id = gid and child_name = 'Czakó Adél Luca';
  if uid4 is not null then
    insert into public.parent_child_links (group_id, user_id, child_name) values (gid, uid4, 'Czakó Adél Luca')
    on conflict (group_id, user_id, child_name) do nothing;
  end if;
end $$;
