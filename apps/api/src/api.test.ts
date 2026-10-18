import type { Database } from '@fi/db';
import { apiKeys, auditEvents, eq, invoices, pdpSubmissions, sha256, sql } from '@fi/db';
import { createMockPdpAdapter, MOCK_HEADERS, type MockWebhook, signWebhook } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_TOKEN,
  draft,
  newTenant,
  type RecordedJobs,
  testApi,
  testDatabase,
} from './test-helpers';

const SECRET = 'api-test-webhook-secret';
const mock = createMockPdpAdapter({ baseUrl: 'http://mock.invalid', webhookSecret: SECRET });

let database: Database;
let request: ReturnType<typeof testApi>['request'];
let jobs: RecordedJobs;

beforeAll(async () => {
  database = await testDatabase();
  ({ request, jobs } = testApi(database, { mock }));
});
afterAll(async () => {
  await database.close();
});

interface Detail {
  id: string;
  number: string;
  status: string;
  statusLabel: string;
  fingerprint: string;
  payable: number;
  issues: { ruleId: string; severity: string; messageFr: string }[];
  events: { type: string; event: string | null; actor: string; toStatus: string | null }[];
}
interface ErrorBody {
  error: { code: string; message: string; details?: string };
}

async function create(apiKey: string, body: unknown) {
  const res = await request('/invoices', { method: 'POST', token: apiKey, body });
  return { status: res.status, body: (await res.json()) as Detail & ErrorBody };
}

describe('health', () => {
  it('answers with its environment', async () => {
    const res = await request('/health');
    expect(await res.json()).toEqual({ ok: true, service: 'api', env: 'local' });
  });

  it('answers 404 in French on an unknown route', async () => {
    const res = await request('/nowhere');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('route_not_found');
  });
});

describe('admin: tenants', () => {
  it('creates a tenant and shows its key once, storing only the hash', async () => {
    const { id, apiKey } = await newTenant(request);
    expect(apiKey).toMatch(/^fik_[\w-]{32}$/);
    const [key] = await database.db.select().from(apiKeys).where(eq(apiKeys.tenantId, id));
    expect(key?.hash).toBe(sha256(apiKey));
    const me = await request('/tenant', { token: apiKey });
    expect(await me.json()).toMatchObject({ id, siren: '100000009', pdpProvider: 'mock' });
    const actions = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, id));
    expect(actions.map((a) => a.action)).toEqual(['tenant.create', 'api_key.create']);
  });

  it('needs the admin token', async () => {
    const body = { name: 'X', siren: '100000009' };
    const wrong = await request('/admin/tenants', { method: 'POST', token: 'nope', body });
    expect(wrong.status).toBe(403);
    const disabled = testApi(database, { mock }, null).request;
    const off = await disabled('/admin/tenants', { method: 'POST', token: ADMIN_TOKEN, body });
    expect(off.status).toBe(503);
  });

  it('refuses a bad SIREN and a platform this server cannot reach', async () => {
    const bad = await request('/admin/tenants', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { name: 'X', siren: '123456789' },
    });
    expect(bad.status).toBe(400);
    const b2b = await request('/admin/tenants', {
      method: 'POST',
      token: ADMIN_TOKEN,
      body: { name: 'X', siren: '100000009', pdpProvider: 'b2brouter' },
    });
    expect(b2b.status).toBe(409);
    expect(((await b2b.json()) as ErrorBody).error.code).toBe('pdp_not_configured');
  });
});

describe('tenant auth', () => {
  it('refuses a missing, unknown or revoked key with a calm French message', async () => {
    const none = await request('/invoices');
    expect(none.status).toBe(401);
    expect(((await none.json()) as ErrorBody).error.message).toBe(
      "Votre clé d'accès n'est pas reconnue. Aucune facture n'a été touchée. Vérifiez la clé dans les réglages du complément.",
    );
    expect((await request('/invoices', { token: 'fik_unknown' })).status).toBe(401);
    const { id, apiKey } = await newTenant(request);
    await database.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.tenantId, id));
    expect((await request('/invoices', { token: apiKey })).status).toBe(401);
  });

  it('updates the tenant settings and audits the change', async () => {
    const { id, apiKey } = await newTenant(request);
    const res = await request('/tenant', {
      method: 'PATCH',
      token: apiKey,
      body: { vatOnDebits: true },
    });
    expect(await res.json()).toMatchObject({ vatOnDebits: true });
    const rows = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, id));
    expect(rows.map((r) => r.action)).toContain('tenant.update');
  });
});

describe('POST /validate', () => {
  it('runs the core rules on a draft and stores nothing', async () => {
    const { id, apiKey } = await newTenant(request);
    const ok = await request('/validate', {
      method: 'POST',
      token: apiKey,
      body: { draft: draft(1) },
    });
    expect(await ok.json()).toMatchObject({ valid: true, issues: [] });
    const bad = await request('/validate', {
      method: 'POST',
      token: apiKey,
      body: { draft: draft(2, (d) => (d.buyer.name = '')) },
    });
    const body = (await bad.json()) as { valid: boolean; issues: Detail['issues'] };
    expect(body.valid).toBe(false);
    expect(body.issues).toContainEqual(
      expect.objectContaining({ ruleId: 'BR-07', messageFr: 'Le nom de votre client manque.' }),
    );
    const [count] = await database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .where(eq(invoices.tenantId, id));
    expect(count?.n).toBe(0);
  });

  it('answers 400 with details for a body that is not a draft', async () => {
    const { apiKey } = await newTenant(request);
    const res = await request('/validate', {
      method: 'POST',
      token: apiKey,
      body: { draft: { lines: 3 } },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details).toMatch(/lines/);
    const notJson = await request('/validate', { method: 'POST', token: apiKey, body: '{' });
    expect(notJson.status).toBe(400);
  });
});

describe('invoices', () => {
  it('creates and validates an invoice, with its timeline and audit', async () => {
    const { apiKey } = await newTenant(request);
    const { status, body } = await create(apiKey, { draft: draft(1) });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      number: draft(1).number,
      status: 'validated',
      statusLabel: 'Vérifiée',
      issues: [],
    });
    expect(body.payable).toBeGreaterThan(0);
    expect(body.events).toEqual([
      expect.objectContaining({ type: 'transition', event: 'validation_passed', actor: 'system' }),
    ]);
    const audit = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.objectId, body.id));
    expect(audit.map((a) => a.action)).toEqual(['invoice.create', 'invoice.validation_passed']);
  });

  it('returns the same invoice when it is created twice, even at the same moment', async () => {
    const { apiKey } = await newTenant(request);
    const answers = await Promise.all([1, 2, 3].map(() => create(apiKey, { draft: draft(1) })));
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 200, 201]);
  });

  it('refuses another invoice under a number already used', async () => {
    const { apiKey } = await newTenant(request);
    await create(apiKey, { draft: draft(1) });
    const { status, body } = await create(apiKey, {
      draft: draft(1, (d) => (d.paymentTerms = 'Paiement à réception.')),
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe('number_taken');
    expect(body.error.message).toContain(draft(1).number);
  });

  it('refuses an invoice issued in another company’s name', async () => {
    const { apiKey } = await newTenant(request);
    const other = draft(1, (d) => {
      if (d.seller.legalId) d.seller.legalId.id = '200000008';
    });
    const { status, body } = await create(apiKey, { draft: other });
    expect(status).toBe(422);
    expect(body.error.code).toBe('seller_mismatch');
  });

  it('stores an invoice with blocking errors as needs_fix', async () => {
    const { apiKey } = await newTenant(request);
    const { status, body } = await create(apiKey, { draft: draft(1, (d) => (d.buyer.name = '')) });
    expect(status).toBe(201);
    expect(body.status).toBe('needs_fix');
    expect(body.issues.map((i) => i.ruleId)).toContain('BR-07');
  });

  it('lists, filters and keeps tenants apart', async () => {
    const a = await newTenant(request);
    const b = await newTenant(request);
    const created = await create(a.apiKey, { draft: draft(1) });
    await create(a.apiKey, { draft: draft(2, (d) => (d.buyer.name = '')) });
    const list = async (query: string, key = a.apiKey) =>
      (
        (await (await request(`/invoices${query}`, { token: key })).json()) as {
          invoices: Detail[];
        }
      ).invoices;
    expect(await list('')).toHaveLength(2);
    expect((await list('?status=needs_fix')).map((i) => i.number)).toEqual([draft(2).number]);
    expect(await list('', b.apiKey)).toHaveLength(0);
    expect((await request(`/invoices/${created.body.id}`, { token: b.apiKey })).status).toBe(404);
    expect((await request('/invoices/not-a-uuid', { token: a.apiKey })).status).toBe(404);
    expect((await request('/invoices?status=nope', { token: a.apiKey })).status).toBe(400);
  });

  it('edits a draft and validates it again', async () => {
    const { apiKey } = await newTenant(request);
    const { body } = await create(apiKey, { draft: draft(1, (d) => (d.buyer.name = '')) });
    const res = await request(`/invoices/${body.id}`, {
      method: 'PUT',
      token: apiKey,
      body: { draft: draft(1) },
    });
    const fixed = (await res.json()) as Detail;
    expect(fixed.status).toBe('validated');
    expect(fixed.fingerprint).not.toBe(body.fingerprint);
    expect(fixed.events.map((e) => e.event)).toEqual(['validation_failed', 'validation_passed']);
    const again = await request(`/invoices/${body.id}/validate`, { method: 'POST', token: apiKey });
    expect(((await again.json()) as Detail).status).toBe('validated');
  });

  it('refuses an edit to a number already used', async () => {
    const { apiKey } = await newTenant(request);
    await create(apiKey, { draft: draft(1) });
    const { body } = await create(apiKey, { draft: draft(2) });
    const res = await request(`/invoices/${body.id}`, {
      method: 'PUT',
      token: apiKey,
      body: { draft: draft(1) },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('number_taken');
  });

  it('serves the CII XML', async () => {
    const { apiKey } = await newTenant(request);
    const { body } = await create(apiKey, { draft: draft(1) });
    const res = await request(`/invoices/${body.id}/xml`, { token: apiKey });
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(await res.text()).toContain('CrossIndustryInvoice');
  });
});

describe('send and cancel', () => {
  it('approves and queues once, however many times « Envoyer » is pressed', async () => {
    const { apiKey } = await newTenant(request);
    const { body } = await create(apiKey, { draft: draft(1) });
    const before = jobs.sends.length;
    const answers = await Promise.all(
      [1, 2, 3].map(async () => {
        const res = await request(`/invoices/${body.id}/send`, { method: 'POST', token: apiKey });
        return {
          status: res.status,
          body: (await res.json()) as { status: string; alreadySent: boolean },
        };
      }),
    );
    expect(answers.every((a) => a.status === 202 && a.body.status === 'ready_to_send')).toBe(true);
    expect(answers.filter((a) => !a.body.alreadySent)).toHaveLength(1);
    expect(jobs.sends.slice(before).every((id) => id === body.id)).toBe(true);
    const detail = (await (
      await request(`/invoices/${body.id}`, { token: apiKey })
    ).json()) as Detail;
    expect(detail.events.filter((e) => e.event === 'approve')).toEqual([
      expect.objectContaining({ actor: 'user', toStatus: 'ready_to_send' }),
    ]);
  });

  it('refuses to send an invoice with blocking errors', async () => {
    const { apiKey } = await newTenant(request);
    const { body } = await create(apiKey, { draft: draft(1, (d) => (d.buyer.name = '')) });
    const res = await request(`/invoices/${body.id}/send`, { method: 'POST', token: apiKey });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('has_errors');
  });

  it('cancels before sending and frees the number', async () => {
    const { apiKey } = await newTenant(request);
    const { body } = await create(apiKey, { draft: draft(1) });
    const res = await request(`/invoices/${body.id}/cancel`, { method: 'POST', token: apiKey });
    expect(((await res.json()) as Detail).status).toBe('cancelled');
    const again = await create(apiKey, { draft: draft(1, (d) => (d.paymentTerms = 'Autre.')) });
    expect(again.status).toBe(201);
    const edit = await request(`/invoices/${body.id}`, {
      method: 'PUT',
      token: apiKey,
      body: { draft: draft(1) },
    });
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as ErrorBody).error.code).toBe('not_editable');
  });

  it('does not cancel an invoice the platform may already hold', async () => {
    const { id, apiKey } = await newTenant(request);
    const { body } = await create(apiKey, { draft: draft(1) });
    await request(`/invoices/${body.id}/send`, { method: 'POST', token: apiKey });
    // A send was attempted and its answer lost: the invoice went back to ready_to_send.
    await database.db.insert(pdpSubmissions).values({
      tenantId: id,
      invoiceId: body.id,
      idempotencyKey: `lost-${body.id}`,
      provider: 'mock',
    });
    const res = await request(`/invoices/${body.id}/cancel`, { method: 'POST', token: apiKey });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('send_attempted');
  });

  it('cannot send without a configured platform', async () => {
    const noPdp = testApi(database, {});
    const { apiKey } = await newTenant(request);
    const { body } = await create(apiKey, { draft: draft(1) });
    const res = await noPdp.request(`/invoices/${body.id}/send`, { method: 'POST', token: apiKey });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('pdp_not_configured');
  });
});

describe('POST /webhooks/pdp/:provider', () => {
  const webhook = (data: Partial<MockWebhook['data']> = {}) =>
    JSON.stringify({
      code: 'issued_invoice.state_change',
      triggered_at: 1,
      data: {
        account_id: 'acct',
        invoice_id: 'inv_000001',
        event_id: 'evt_1',
        state: 'delivered',
        ...data,
      },
    });
  const post = (body: string, signature?: string, provider = 'mock') =>
    request(`/webhooks/pdp/${provider}`, {
      method: 'POST',
      body,
      headers: signature ? { [MOCK_HEADERS.signature]: signature } : {},
    });

  it('queues a status sync for a signed webhook', async () => {
    const body = webhook();
    const before = jobs.syncs.length;
    const res = await post(body, signWebhook(SECRET, body));
    expect(res.status).toBe(202);
    expect(jobs.syncs.slice(before)).toEqual([
      { provider: 'mock', account: 'acct', pdpRef: 'inv_000001' },
    ]);
  });

  it('refuses an unsigned or tampered webhook, an unknown provider and an unreadable body', async () => {
    const body = webhook();
    expect((await post(body)).status).toBe(401);
    expect((await post(`${body} `, signWebhook(SECRET, body))).status).toBe(401);
    expect((await post(body, signWebhook(SECRET, body), 'b2brouter')).status).toBe(404);
    expect((await post('{"x":1}', signWebhook(SECRET, '{"x":1}'))).status).toBe(400);
  });
});
