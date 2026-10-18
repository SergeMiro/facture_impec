-- Trial-access requests from the marketing site (apps/site/src/pages/api/trial.ts).
-- Apply once to the Supabase project whose URL and secret key the site uses.
-- Only the server-side secret key reads or writes this table: RLS is on and there is no policy.

create table if not exists public.trial_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  email text not null check (char_length(email) <= 200),
  company text not null check (char_length(company) between 1 and 160),
  siren text check (siren ~ '^[0-9]{9}$'),
  profile text not null check (profile in ('company', 'accountant')),
  invoices_per_month text not null check (invoices_per_month in ('lt20', '20to100', '100to500', 'gt500')),
  excel text not null check (excel in ('windows', 'mac', 'web', 'unknown')),
  plan text check (plan in ('essentiel', 'croissance', 'cabinet')),
  message text check (char_length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'active', 'declined')),
  -- Consent is required by the form; keeping the timestamp proves when it was given.
  consent_at timestamptz not null default now()
);

-- One request per e-mail: a repeated submission is ignored by the endpoint (on_conflict=email).
create unique index if not exists trial_requests_email_key on public.trial_requests (email);

alter table public.trial_requests enable row level security;
revoke all on public.trial_requests from anon, authenticated;
