-- Keeps the Supabase project facture-impec (adphrypzszrohihaetnu) out of Free-plan pausing.
-- Supabase pauses a Free project after ~7 days without *user* database activity; trial requests are
-- too rare to count on. A daily cron on the VPS (~/.local/bin/fi-supabase-keepalive, docs/RUNBOOK.md
-- § Marketing site) calls `POST /rest/v1/rpc/keepalive` with the project's secret key: one write and
-- one read, on a single row that never grows. Applied on 2026-10-19.

create table if not exists public.heartbeat (
  id integer primary key default 1 check (id = 1),
  seen_at timestamptz not null default now(),
  hits bigint not null default 0
);

insert into public.heartbeat (id) values (1) on conflict (id) do nothing;

alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;

create or replace function public.keepalive() returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.heartbeat set seen_at = now(), hits = hits + 1 where id = 1 returning seen_at;
$$;

-- Only the secret key (service_role) may call it: nothing that writes is reachable with the
-- publishable key.
revoke all on function public.keepalive() from public, anon, authenticated;
grant execute on function public.keepalive() to service_role;
