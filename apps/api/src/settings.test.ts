// Réglages (plan §5 screen 6) and RGPD (plan §10): settings, the tenant's own AI key, the export and
// the deletion.
import { randomBytes } from 'node:crypto';
import type { ResolvedAi } from '@fi/agents';
import type { Database } from '@fi/db';
import { auditEvents, chasePlans, eq, invoiceEvents, invoices, tenants, users } from '@fi/db';
import { createMockPdpAdapter } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveAi } from './ai';
import {
  ADMIN_TOKEN,
  draft,
  newTenant,
  signIn,
  testAi,
  testApi,
  testDatabase,
} from './test-helpers';

const mock = createMockPdpAdapter({ baseUrl: 'http://mock.invalid', webhookSecret: 'x' });
const SEALING_KEY = randomBytes(32).toString('base64');
const KEY = 'sk-test-0123456789abcdef';

let database: Database;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];
const probed: ResolvedAi[] = [];
let probeFailure: 'auth' | undefined;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock }, undefined, {
    ai: testAi(database, {
      sealingKey: SEALING_KEY,
      probe: async (resolved) => {
        probed.push(resolved);
        return {
          capabilities: { text: true, json: true, tools: false, checkedAt: '2026-10-18T08:00:00Z' },
          ...(probeFailure && { failure: probeFailure, detail: '401 from provider' }),
        };
      },
    }),
  });
  ({ request } = api);
});
afterAll(async () => {
  await database.close();
});

interface ErrorBody {
  error: { code: string; message: string };
}
interface Settings {
  mode: string;
  autopilotAvailable: boolean;
  autopilotMaxAmount: number | null;
  sandboxEnabled: boolean;
  testPlatform: boolean;
  pseudonymizeLlm: boolean;
  chaseCadence: number[];
  invoiceDefaults: Record<string, unknown>;
  pdp: {
    provider: string;
    account: string;
    connected: boolean;
    ownKey: { available: boolean; hint: string | null };
  };
  ai: Record<string, unknown>;
}

const patch = (token: string, body: unknown) =>
  request('/settings', { method: 'PATCH', token, body });
const putAi = (token: string, body: unknown) =>
  request('/settings/ai', { method: 'PUT', token, body });
const BYOK = {
  mode: 'byok',
  provider: 'mistral',
  models: { agent: 'mistral-small-latest', classify: 'mistral-small-latest' },
};

describe('settings', () => {
  it('shows the defaults: review mode, test mode on, pseudonymization locked on', async () => {
    const t = await newTenant(request);
    const res = await request('/settings', { token: t.apiKey });
    expect(await res.json()).toEqual({
      mode: 'review',
      autopilotAvailable: true,
      autopilotMaxAmount: null,
      sandboxEnabled: true,
      testPlatform: true,
      pseudonymizeLlm: true,
      chaseCadence: [-3, 1, 8, 15, 30],
      invoiceDefaults: {},
      pdp: {
        provider: 'mock',
        account: t.account,
        connected: true,
        ownKey: { available: false, hint: null },
      },
      ai: { mode: 'included', includedProvider: null, byokAvailable: true },
    } satisfies Settings);
  });

  it('saves test mode, the chasing cadence and the invoice defaults, with an audit event', async () => {
    const t = await newTenant(request);
    const res = await patch(t.apiKey, {
      sandboxEnabled: false,
      chaseCadence: [0, 7, 21],
      invoiceDefaults: { iban: 'FR7630006000011234567890189', paymentDays: 45 },
    });
    expect(await res.json()).toMatchObject({
      sandboxEnabled: false,
      chaseCadence: [0, 7, 21],
      invoiceDefaults: {
        iban: 'FR7630006000011234567890189',
        paymentDays: 45,
        paymentMeansCode: '30',
        currency: 'EUR',
      },
    });
    for (const bad of [
      { chaseCadence: [8, 1] },
      { chaseCadence: [] },
      { mode: 'autopilot' },
      { pseudonymizeLlm: false },
    ]) {
      const refused = await patch(t.apiKey, bad);
      expect(refused.status, JSON.stringify(bad)).toBe(400);
    }
    const log = await database.db.select().from(auditEvents).where(eq(auditEvents.tenantId, t.id));
    expect(log.map((a) => a.action)).toContain('settings.update');
  });

  it('turns the chasing autopilot on only with a ceiling, and only where mail can be sent', async () => {
    const t = await newTenant(request);
    const refused = await patch(t.apiKey, { mode: 'autopilot' });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as ErrorBody).error.code).toBe('autopilot_needs_ceiling');

    const on = await patch(t.apiKey, { mode: 'autopilot', autopilotMaxAmount: 200_000 });
    expect(await on.json()).toMatchObject({ mode: 'autopilot', autopilotMaxAmount: 200_000 });
    // The ceiling cannot be removed while the autopilot runs; back in review it may.
    expect((await patch(t.apiKey, { autopilotMaxAmount: null })).status).toBe(400);
    const off = await patch(t.apiKey, { mode: 'review', autopilotMaxAmount: null });
    expect(await off.json()).toMatchObject({ mode: 'review', autopilotMaxAmount: null });

    const mailless = testApi(database, { mock }, undefined, { mailer: null });
    const other = await newTenant(mailless.request);
    const view = await mailless.request('/settings', { token: other.apiKey });
    expect(await view.json()).toMatchObject({ autopilotAvailable: false });
    const unavailable = await mailless.request('/settings', {
      method: 'PATCH',
      token: other.apiKey,
      body: { mode: 'autopilot', autopilotMaxAmount: 100_000 },
    });
    expect(unavailable.status).toBe(409);
    expect(((await unavailable.json()) as ErrorBody).error.code).toBe('autopilot_unavailable');
  });
});

describe('AI settings', () => {
  it('tests a key before saving it, seals it and only shows its last characters', async () => {
    const t = await newTenant(request);
    const res = await putAi(t.apiKey, { ...BYOK, apiKey: KEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Settings;
    expect(body.ai).toMatchObject({
      mode: 'byok',
      provider: 'mistral',
      keyHint: '…cdef',
      capabilities: { tools: false },
    });
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(probed.at(-1)).toMatchObject({ apiKey: KEY, settings: { provider: 'mistral' } });

    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(row?.aiKeySealed).toBeTruthy();
    expect(row?.aiKeySealed).not.toContain(KEY);
    if (!row) throw new Error('gone');
    expect(resolveAi(api.deps.ai, row)?.apiKey).toBe(KEY);

    // Saving other models without retyping the key keeps it, and tests it again.
    const again = await putAi(t.apiKey, {
      ...BYOK,
      models: { agent: 'mistral-medium-latest', classify: 'mistral-small-latest' },
    });
    expect(((await again.json()) as Settings).ai).toMatchObject({ keyHint: '…cdef' });
    expect(probed.at(-1)?.apiKey).toBe(KEY);
  });

  it('refuses settings the provider does not accept, and saves nothing', async () => {
    const t = await newTenant(request);
    probeFailure = 'auth';
    try {
      const res = await putAi(t.apiKey, { ...BYOK, apiKey: 'sk-wrong-key-000000' });
      expect(res.status).toBe(422);
      const { error } = (await res.json()) as ErrorBody;
      expect(error.code).toBe('ai_probe');
      expect(error.message).toContain("La clé n'a pas été acceptée");
      expect(error.message).not.toContain('401');
    } finally {
      probeFailure = undefined;
    }
    const local = await putAi(t.apiKey, {
      ...BYOK,
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:47821/v1',
      apiKey: KEY,
    });
    expect(local.status).toBe(422);
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(row?.aiSettings).toBeNull();
  });

  it('switches to off and back to included, dropping the stored key', async () => {
    const t = await newTenant(request);
    await putAi(t.apiKey, { ...BYOK, apiKey: KEY });
    const off = (await (await putAi(t.apiKey, { mode: 'off' })).json()) as Settings;
    expect(off.ai).toEqual({ mode: 'off', includedProvider: null, byokAvailable: true });
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(row?.aiKeySealed).toBeNull();
    if (row) expect(resolveAi(api.deps.ai, row)).toBeNull();
    const included = (await (await putAi(t.apiKey, { mode: 'included' })).json()) as Settings;
    expect(included.ai.mode).toBe('included');
  });

  it('refuses a own key where the server cannot seal it', async () => {
    const noSeal = testApi(database, { mock });
    const t = await newTenant(noSeal.request);
    const res = await noSeal.request('/settings/ai', {
      method: 'PUT',
      token: t.apiKey,
      body: { ...BYOK, apiKey: KEY },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('byok_disabled');
  });
});

describe('RGPD', () => {
  async function tenantWithData() {
    const email = `rgpd${randomBytes(4).toString('hex')}@example.test`;
    const t = await newTenant(request, { ownerEmail: email });
    const create = async (index: number, test = false) => {
      const res = await request('/invoices', {
        method: 'POST',
        token: t.apiKey,
        body: { draft: draft(index), test },
      });
      return ((await res.json()) as { id: string }).id;
    };
    const drafted = await create(1);
    const test = await create(2, true);
    const sent = await create(3);
    // A platform holds this one: the law keeps it.
    await database.db.update(invoices).set({ pdpRef: 'inv_kept' }).where(eq(invoices.id, sent));
    // Its chasing draft and the MonitorAgent's reply quote the customer's address.
    const reply = { to: 'compta@client.test', subject: 'Facture', body: 'Bonjour' };
    await database.db.insert(chasePlans).values({
      tenantId: t.id,
      invoiceId: sent,
      cadence: [1],
      dueDate: '2026-11-14',
      steps: [
        {
          offset: 1,
          kind: 'reminder',
          date: '2026-11-15',
          status: 'drafted',
          at: null,
          by: null,
          reason: 'review',
          draft: reply,
        },
      ],
      nextStepOn: null,
    });
    await database.db.insert(invoiceEvents).values({
      invoiceId: sent,
      type: 'note',
      actor: 'agent:monitor',
      event: 'monitor',
      payload: { for: 0, proposal: 'contact_customer', draft: reply },
    });
    return { ...t, email, drafted, test, sent };
  }

  it('exports everything the tenant has, without secrets', async () => {
    const t = await tenantWithData();
    await putAi(t.apiKey, { ...BYOK, apiKey: KEY });
    const res = await request('/tenant/export', { token: t.apiKey });
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const text = await res.text();
    const data = JSON.parse(text) as Record<string, unknown[]>;
    expect(data.users).toMatchObject([{ email: t.email, role: 'owner' }]);
    expect(data.invoices).toHaveLength(3);
    expect(data.invoices).toContainEqual(
      expect.objectContaining({ chase: expect.objectContaining({ dueDate: '2026-11-14' }) }),
    );
    expect(data.weeklyReports).toEqual([]);
    expect(data.auditEvents?.length).toBeGreaterThan(3);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/fik_|"hash"|aiKeySealed/);
  });

  it('deletes what the law lets go, keeps the transmitted invoices, and locks every way in', async () => {
    const t = await tenantWithData();
    const session = await signIn(request, api.mailer, t.email);

    const mismatch = await request('/tenant', {
      method: 'DELETE',
      token: session,
      body: { confirmSiren: '999999999' },
    });
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as ErrorBody).error.code).toBe('confirm_mismatch');

    const res = await request('/tenant', {
      method: 'DELETE',
      token: session,
      body: { confirmSiren: '100 000 009' },
    });
    expect(await res.json()).toEqual({ deleted: { invoices: 2, users: 1 }, keptInvoices: 1 });
    const left = await database.db.select().from(invoices).where(eq(invoices.tenantId, t.id));
    expect(left.map((r) => r.id)).toEqual([t.sent]);
    expect(
      await database.db.select().from(chasePlans).where(eq(chasePlans.tenantId, t.id)),
    ).toEqual([]);
    const notes = await database.db
      .select()
      .from(invoiceEvents)
      .where(eq(invoiceEvents.invoiceId, t.sent));
    expect(notes.find((n) => n.event === 'monitor')?.payload).toEqual({
      for: 0,
      proposal: 'contact_customer',
    });
    expect(JSON.stringify(notes)).not.toContain('compta@client.test');
    expect(await database.db.select().from(users).where(eq(users.tenantId, t.id))).toEqual([]);
    expect((await request('/tenant', { token: t.apiKey })).status).toBe(401);
    expect((await request('/tenant', { token: session })).status).toBe(401);
    const log = await database.db.select().from(auditEvents).where(eq(auditEvents.tenantId, t.id));
    expect(log.at(-1)?.action).toBe('tenant.delete');
    expect(JSON.stringify(log)).not.toContain(t.email);
    // The address is free again: a new company can sign it up.
    expect((await newTenant(request, { ownerEmail: t.email })).id).not.toBe(t.id);
  });

  it('lets only the owner delete or export', async () => {
    const email = `member${randomBytes(4).toString('hex')}@example.test`;
    const t = await newTenant(request);
    await database.db.insert(users).values({ tenantId: t.id, email, role: 'member' });
    const session = await signIn(request, api.mailer, email);
    expect((await request('/tenant/export', { token: session })).status).toBe(403);
    const res = await request('/tenant', {
      method: 'DELETE',
      token: session,
      body: { confirmSiren: '100000009' },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('owner_only');
    expect(ADMIN_TOKEN).toBeTruthy();
  });
});
