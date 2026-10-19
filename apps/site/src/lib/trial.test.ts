import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTrial, type TrialConfig } from './trial';

const valid = {
  firstName: 'Claire',
  lastName: 'Martin',
  email: 'Claire@Example.fr',
  company: 'Boulangerie Martin',
  siren: '812 345 676',
  profile: 'company',
  invoicesPerMonth: '20to100',
  excel: 'mac',
  plan: 'croissance',
  consent: true,
};
const human = () => Date.now() - 10_000;
const stored: TrialConfig = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseKey: 'sb_publishable_test',
  dev: false,
};

const call = async (body: unknown, config: TrialConfig = { dev: true }) => {
  const request = new Request('http://localhost/api/trial', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handleTrial(request, config);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const stubFetch = (status: number) => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => vi.unstubAllGlobals());

describe('handleTrial', () => {
  it('answers bots with a silent success and stores nothing', async () => {
    const fetch = stubFetch(201);
    expect(await call({ ...valid, website: 'spam', startedAt: human() }, stored)).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect((await call({ ...valid, startedAt: Date.now() }, stored)).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a French message per invalid field', async () => {
    const res = await call({ ...valid, email: 'claire@', siren: '123', startedAt: human() });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({
      email: 'Cette adresse e-mail ne semble pas valide.',
      siren: 'Le SIREN compte 9 chiffres (vous pouvez aussi laisser ce champ vide).',
    });
  });

  it('rejects a body that is not a JSON object', async () => {
    expect((await call('not json')).status).toBe(400);
    expect((await call([1, 2])).status).toBe(400);
  });

  it('accepts without storage in development but refuses in production', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call({ ...valid, startedAt: human() }, { dev: true })).status).toBe(200);
    const prod = await call({ ...valid, startedAt: human() }, { dev: false });
    expect(prod.status).toBe(503);
    expect(prod.body.message).toContain('n’a pas été enregistrée');
  });

  it('stores one normalised request through the only function the key may call', async () => {
    const fetch = stubFetch(201);
    expect((await call({ ...valid, startedAt: human() }, stored)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/submit_trial_request');
    const headers = init?.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_publishable_test');
    expect(headers.authorization).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual({
      p_first_name: 'Claire',
      p_last_name: 'Martin',
      p_email: 'claire@example.fr',
      p_company: 'Boulangerie Martin',
      p_siren: '812345676',
      p_profile: 'company',
      p_invoices_per_month: '20to100',
      p_excel: 'mac',
      p_plan: 'croissance',
      p_message: null,
    });
  });

  it('sends a legacy JWT key as a bearer token too', async () => {
    const fetch = stubFetch(201);
    await call({ ...valid, startedAt: human() }, { ...stored, supabaseKey: 'eyJhbGciOi.test' });
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer eyJhbGciOi.test');
  });

  it('tells the visitor their data is still in the form when storage fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(500);
    const res = await call({ ...valid, startedAt: human() }, stored);
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('toujours dans le formulaire');
  });

  it('notifies the owner without personal data', async () => {
    const fetch = stubFetch(201);
    await call(
      { ...valid, startedAt: human() },
      { ...stored, telegramToken: 'tok', telegramChatId: '42' },
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1] ?? [];
    expect(url).toBe('https://api.telegram.org/bottok/sendMessage');
    const text = String(JSON.parse(String(init?.body)).text);
    expect(text).toContain('Boulangerie Martin');
    expect(text).not.toMatch(/claire|martin@|812345676/i);
  });
});
