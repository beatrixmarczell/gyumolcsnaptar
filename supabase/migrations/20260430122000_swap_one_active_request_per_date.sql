-- Csoport + naptári nap: legfeljebb egy `requested` állapotú csere kérelem.
-- Meglévő többszörös nyitott sorok: a legrégebbi marad.
delete from public.swap_requests a
where a.status = 'requested'
  and exists (
    select 1
    from public.swap_requests b
    where b.group_id = a.group_id
      and b.requester_date_key = a.requester_date_key
      and b.status = 'requested'
      and (
        b.created_at < a.created_at
        or (b.created_at = a.created_at and b.id::text < a.id::text)
      )
  );

create unique index if not exists idx_swap_requests_one_active_per_date
  on public.swap_requests (group_id, requester_date_key)
  where status = 'requested';
