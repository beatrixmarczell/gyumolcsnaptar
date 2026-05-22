-- Értesítési preferenciák a user_profiles táblán.
-- notification_email: ha null, a keycloak_sub-hoz tartozó email cím lesz használva.
-- notify_email_*/notify_push_*: külön toggle a naptár-emlékeztetőhöz és cserékhez.

alter table public.user_profiles
  add column if not exists notification_email text,
  add column if not exists notify_email_calendar boolean not null default true,
  add column if not exists notify_push_calendar boolean not null default true,
  add column if not exists notify_email_swap boolean not null default true,
  add column if not exists notify_push_swap boolean not null default true;
