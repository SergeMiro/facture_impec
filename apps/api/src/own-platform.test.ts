// A company's own platform key (docs/B2BROUTER.md §12): tried before it is saved, sealed at rest, and
// then every real call goes through it while « Mode test » keeps going through ours.
import { randomBytes } from 'node:crypto';
import type { Database } from '@fi/db';
import { auditEvents, eq, tenants, users } from '@fi/db';
import { type PdpAdapter, PdpRequestError } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OwnPlatform } from './deps';
import { routeFor } from './platform';
import {
  draft,
  fakeAdapter,
  newTenant,
  recordedJobs,
  signIn,
  testApi,
  testDatabase,
} from './test-helpers';
import { runSend, type WorkerDeps } from './workers';

const SEALING_KEY = randomBytes(32).toString('base64');
const KEY = 'test_company_key_0123456789';

/** Who called the platform, with which key: 'ours' for the deployment's adapter. */
const calls: { key: string; call: string; account?: string }[] = [];
let probe: () => Promise<void> = async () => {};

function recording(key: string): PdpAdapter {
  return fakeAdapter({
    sendInvoice: async ({ account }) => {
      calls.push({ key, call: 'send', account });
      return { outcome: 'deposited', pdpRef: `inv_${key}_${calls.length}` };
    },
    listInbound: async ({ account }) => {
      calls.push({ key, call: 'listInbound', account });
      await probe();
      return [];
    },
  });
}

const ownPdp: OwnPlatform = {
  sealingKey: SEALING_KEY,
  adapter: (provider, apiKey) => {
    if (apiKey.startsWith('prod_')) throw new Error('a sandbox key (test_…)');
    return provider === 'mock' ? recording(apiKey) : null;
  },
};

let database: Database;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: recording('ours') }, undefined, { ownPdp });
  ({ request } = api);
});
afterAll(async () => {
  await database.close();
});

interface PdpView {
  provider: string;
  account: string;
  connected: boolean;
  ownKey: { available: boolean; hint: string | null };
}
interface ErrorBody {
  error: { code: string; message: string };
}

const saveKey = (apiKey: string, body: Record<string, unknown>) =>
  request('/settings/pdp', { method: 'PUT', token: apiKey, body });

const worker = (): WorkerDeps => ({
  db: database.db,
  pdp: api.deps.pdp,
  test: api.deps.test,
  ownPdp,
  jobs: recordedJobs(),
  ai: api.deps.ai,
  mailer: null,
  now: () => new Date(),
});

async function queued(apiKey: string, index: number, test = false) {
  const res = await request('/invoices', {
    method: 'POST',
    token: apiKey,
    body: { draft: draft(index), ...(test && { test: true }) },
  });
  const { id } = (await res.json()) as { id: string };
  expect((await request(`/invoices/${id}/send`, { method: 'POST', token: apiKey })).status).toBe(
    202,
  );
  return id;
}

describe('saving the key', () => {
  it('tries the key on the account, seals it, and shows only its end', async () => {
    const t = await newTenant(request);
    const res = await saveKey(t.apiKey, { apiKey: KEY, account: 'own-account-1' });
    expect(res.status).toBe(200);
    const { pdp } = (await res.json()) as { pdp: PdpView };
    expect(pdp).toMatchObject({
      account: 'own-account-1',
      connected: true,
      ownKey: { available: true, hint: '…6789' },
    });
    expect(calls.at(-1)).toEqual({ key: KEY, call: 'listInbound', account: 'own-account-1' });
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(row?.pdpKeySealed).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(KEY);
    const log = await database.db.select().from(auditEvents).where(eq(auditEvents.tenantId, t.id));
    expect(log.map((e) => e.action)).toContain('settings.pdp_key');
    // Neither the key nor its sealed form leaves in the RGPD export.
    const exported = await (await request('/tenant/export', { token: t.apiKey })).text();
    expect(exported).toContain('…6789');
    expect(exported).not.toContain(KEY);
    expect(exported).not.toContain(String(row?.pdpKeySealed));
  });

  it('saves nothing when the platform refuses the key or the account', async () => {
    const t = await newTenant(request);
    const refused = async (status: number) => {
      probe = async () => {
        throw new PdpRequestError(`HTTP ${status}`, status);
      };
      try {
        const res = await saveKey(t.apiKey, { apiKey: KEY });
        expect(res.status).toBe(422);
        const text = await res.text();
        expect(text).not.toContain(KEY);
        return (JSON.parse(text) as ErrorBody).error;
      } finally {
        probe = async () => {};
      }
    };
    expect((await refused(401)).message).toMatch(/^B2Brouter n'a pas accepté cette clé\./);
    expect((await refused(404)).message).toMatch(/^Cette clé n'ouvre pas le compte indiqué\./);
    const other = await saveKey(t.apiKey, { apiKey: 'prod_wrong_environment' });
    expect(((await other.json()) as ErrorBody).error).toMatchObject({
      code: 'pdp_key_refused',
      message: expect.stringContaining('ne correspond pas à cet environnement'),
    });
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(row).toMatchObject({ pdpKeySealed: null, pdpKeyHint: null, pdpAccount: t.account });
  });

  it('is for the owner only, and only where the deployment seals keys', async () => {
    const t = await newTenant(request);
    const email = `member${randomBytes(4).toString('hex')}@example.test`;
    await database.db.insert(users).values({ tenantId: t.id, email, role: 'member' });
    const session = await signIn(request, api.mailer, email);
    const member = await saveKey(session, { apiKey: KEY });
    expect(((await member.json()) as ErrorBody).error.code).toBe('owner_only');
    const plain = testApi(database, { mock: recording('ours') });
    const off = await plain.request('/settings/pdp', {
      method: 'PUT',
      token: t.apiKey,
      body: { apiKey: KEY },
    });
    expect(((await off.json()) as ErrorBody).error.code).toBe('pdp_key_disabled');
    const view = (await (await plain.request('/settings', { token: t.apiKey })).json()) as {
      pdp: PdpView;
    };
    expect(view.pdp.ownKey).toEqual({ available: false, hint: null });
  });
});

describe('using the key', () => {
  it('sends real invoices with the company key and test invoices with ours', async () => {
    const t = await newTenant(request);
    await request('/settings', {
      method: 'PATCH',
      token: t.apiKey,
      body: { sandboxEnabled: true },
    });
    await saveKey(t.apiKey, { apiKey: KEY });
    const real = await queued(t.apiKey, 1);
    const test = await queued(t.apiKey, 2, true);
    calls.length = 0;
    await runSend(worker(), real);
    await runSend(worker(), test);
    expect(calls).toEqual([
      { key: KEY, call: 'send', account: t.account },
      { key: 'ours', call: 'send', account: t.account },
    ]);
  });

  it('stops real sends rather than use our key when the deployment can no longer open it', async () => {
    const t = await newTenant(request);
    await saveKey(t.apiKey, { apiKey: KEY });
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    if (!row) throw new Error('no tenant');
    const deps = { pdp: api.deps.pdp, test: api.deps.test };
    expect(routeFor(deps, row, false)?.adapter).toBeUndefined();
    expect(routeFor(deps, row, true)?.adapter).toBe(api.deps.pdp.mock);
    const keyless = testApi(database, { mock: recording('ours') });
    const view = (await (await keyless.request('/settings', { token: t.apiKey })).json()) as {
      pdp: PdpView;
    };
    expect(view.pdp.connected).toBe(false);
  });
});

describe('once live', () => {
  it('keeps the account, lets the key be replaced but not removed; deletion forgets it', async () => {
    const t = await newTenant(request);
    await saveKey(t.apiKey, { apiKey: KEY });
    await database.db.update(tenants).set({ liveAt: new Date() }).where(eq(tenants.id, t.id));
    const moved = await saveKey(t.apiKey, { apiKey: KEY, account: 'elsewhere' });
    expect(((await moved.json()) as ErrorBody).error.code).toBe('tenant_live');
    const replaced = await saveKey(t.apiKey, { apiKey: 'test_rotated_key_abcd' });
    expect(((await replaced.json()) as { pdp: PdpView }).pdp.ownKey.hint).toBe('…abcd');
    const removed = await request('/settings/pdp', { method: 'DELETE', token: t.apiKey });
    expect(((await removed.json()) as ErrorBody).error.code).toBe('tenant_live');

    await database.db.update(tenants).set({ liveAt: null }).where(eq(tenants.id, t.id));
    const back = await request('/settings/pdp', { method: 'DELETE', token: t.apiKey });
    expect(((await back.json()) as { pdp: PdpView }).pdp.ownKey.hint).toBeNull();

    await saveKey(t.apiKey, { apiKey: KEY });
    const deleted = await request('/tenant', {
      method: 'DELETE',
      token: t.apiKey,
      body: { confirmSiren: '100000009' },
    });
    expect(deleted.status).toBe(200);
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(row).toMatchObject({ pdpKeySealed: null, pdpKeyHint: null });
  });
});
