-- Allow multiple offers per parent on the same request.
-- Keep dedupe only for exact same day proposal.

alter table public.swap_offers
  drop constraint if exists uq_swap_offers_request_user;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'uq_swap_offers_request_user_date'
  ) then
    alter table public.swap_offers
      add constraint uq_swap_offers_request_user_date
      unique (request_id, offer_user_id, offer_date_key);
  end if;
end $$;
