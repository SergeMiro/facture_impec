-- The one door into trial_requests (apps/site/src/lib/trial.ts): the site calls it through PostgREST
-- (`POST /rest/v1/rpc/submit_trial_request`) with the project's publishable key, so the site holds no
-- key that can read or change anything. The table keeps RLS on, no policy and no grant to anon: the
-- function runs as its owner, only inserts, and the table's checks still apply. A repeated e-mail is
-- ignored, as before. Applied to the Supabase project facture-impec (adphrypzszrohihaetnu) on 2026-10-19.

create or replace function public.submit_trial_request(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_company text,
  p_siren text,
  p_profile text,
  p_invoices_per_month text,
  p_excel text,
  p_plan text,
  p_message text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.trial_requests
    (first_name, last_name, email, company, siren, profile, invoices_per_month, excel, plan, message)
  values
    (p_first_name, p_last_name, p_email, p_company, p_siren, p_profile, p_invoices_per_month, p_excel,
     p_plan, p_message)
  on conflict (email) do nothing;
$$;

revoke all on function public.submit_trial_request(text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_trial_request(text, text, text, text, text, text, text, text, text, text)
  to anon;
