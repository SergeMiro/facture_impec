import { TrialRequestSchema } from '@fi/shared';
import { fieldErrors, messages, type TrialField } from '../content/trial-form';

// Trial-access request handler, kept free of Astro imports so it is tested directly.

const MAX_BODY_BYTES = 10_000;
// A human needs more than a few seconds to fill the form; faster submissions are bots.
const MIN_FILL_MS = 3_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export interface TrialConfig {
  supabaseUrl?: string | undefined;
  supabaseKey?: string | undefined;
  telegramToken?: string | undefined;
  telegramChatId?: string | undefined;
  // Without storage, development accepts requests (logged) and production refuses them.
  dev: boolean;
}

export async function handleTrial(request: Request, config: TrialConfig): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return json(413, { ok: false, message: messages.invalid });
  }

  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new Error('not an object');
    body = raw as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, message: messages.invalid });
  }

  // Honeypot and fill time: answer like a success so bots learn nothing.
  const startedAt = typeof body.startedAt === 'number' ? body.startedAt : 0;
  if (body.website || Date.now() - startedAt < MIN_FILL_MS) return json(200, { ok: true });

  const parsed = TrialRequestSchema.safeParse(body);
  if (!parsed.success) {
    const errors: Partial<Record<TrialField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && field in fieldErrors) {
        errors[field as TrialField] = fieldErrors[field as TrialField];
      }
    }
    return json(400, { ok: false, message: messages.invalid, fieldErrors: errors });
  }
  const req = parsed.data;

  const { supabaseUrl, supabaseKey } = config;
  if (!supabaseUrl || !supabaseKey) {
    if (config.dev) {
      console.info('[trial] storage not configured, request accepted in dev only:', req);
      return json(200, { ok: true });
    }
    console.error('[trial] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing: request rejected');
    return json(503, { ok: false, message: messages.unavailable });
  }

  const headers: Record<string, string> = {
    apikey: supabaseKey,
    'content-type': 'application/json',
  };
  // Legacy anon keys are JWTs and also go in Authorization; sb_publishable_ keys must not.
  if (supabaseKey.startsWith('eyJ')) headers.authorization = `Bearer ${supabaseKey}`;

  try {
    // The only thing the key may do (apps/site/sql/002_submit_trial_request.sql): insert one request.
    // A repeated e-mail is ignored there, so it is a success here too.
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/submit_trial_request`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_first_name: req.firstName,
        p_last_name: req.lastName,
        p_email: req.email,
        p_company: req.company,
        p_siren: req.siren ?? null,
        p_profile: req.profile,
        p_invoices_per_month: req.invoicesPerMonth,
        p_excel: req.excel,
        p_plan: req.plan ?? null,
        p_message: req.message ?? null,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error('[trial] storage failed', res.status, await res.text());
      return json(502, { ok: false, message: messages.server });
    }
  } catch (err) {
    console.error('[trial] storage unreachable', err);
    return json(502, { ok: false, message: messages.server });
  }

  await notify(config, req.company, req.profile, req.invoicesPerMonth, req.plan);
  return json(200, { ok: true });
}

// Owner notification without personal data: the details stay in the database.
async function notify(
  { telegramToken, telegramChatId }: TrialConfig,
  company: string,
  profile: string,
  volume: string,
  plan?: string,
) {
  if (!telegramToken || !telegramChatId) return;
  const text = `Nouvelle demande d’essai : ${company} (${profile === 'accountant' ? 'cabinet' : 'entreprise'}, ${volume} factures/mois${plan ? `, offre ${plan}` : ''})`;
  try {
    await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (err) {
    console.warn('[trial] notification failed', err);
  }
}
