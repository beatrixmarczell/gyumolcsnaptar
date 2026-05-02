-- Napi gyümölcs-emlékeztető email deduplikáció: egy (csoport, cél dátum) párra egy küldési kör.

create table if not exists public.fruit_reminder_log (
  group_id uuid not null references public.groups (id) on delete cascade,
  reminder_for_date date not null,
  sent_at timestamptz not null default now(),
  primary key (group_id, reminder_for_date)
);

create index if not exists idx_fruit_reminder_log_sent
  on public.fruit_reminder_log (sent_at desc);

alter table public.fruit_reminder_log enable row level security;

revoke all on public.fruit_reminder_log from anon, authenticated;
