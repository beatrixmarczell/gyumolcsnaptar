-- Public read-only access for calendar state (anonymous viewer mode).
-- Keeps write operations restricted to keycloak-gateway/service role.

grant usage on schema public to anon;
grant select on table public.group_calendar_state to anon;

drop policy if exists "group_calendar_state_select_public_readonly" on public.group_calendar_state;
create policy "group_calendar_state_select_public_readonly"
  on public.group_calendar_state
  for select
  to anon
  using (true);
