// The operator's switches (plan §11 M7) and the limits of an API on the internet: going live in prod,
// an accounting firm's brand, pilot or trial, requests and body sizes, and the purge of sign-in data.
import { addDays, isoWeekday, parisToday } from '@fi/core';
import {
  auditEvents,
  type Database,
  eq,
  magicLinks,
  sessions,
  signupRequests,
  tenants,
} from '@fi/db';
import { t as message, TERMS_VERSION } from '@fi/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestWindows } from './limits';
import { runWeeklyReports } from './report';
import { purgeExpired } from './rgpd';
import {
  ADMIN_TOKEN,
  draft,
  fakeAdapter,
  linkToken,
  newTenant,
  paris,
  recordedJobs,
  runSend,
  signIn,
  testApi,
  testDatabase,
  type WorkerDeps,
} from './test-helpers';
import { runInboundPoll } from './workers';

interface ErrorBody {
  error: { code: string; message: string; details?: string };
}

const DAY = 86_400_000;
let database: Database;
let clock = new Date();
let refs = 0;
/** Accounts the real platform was asked about; `missing` ones answer as if it had none. */
const asked: string[] = [];
const missing = new Set<string>();

/** The test platform (Mode test). */
const platform = fakeAdapter({
  sendInvoice: async () => ({ outcome: 'deposited', pdpRef: `op_${++refs}` }),
});
/** The real one, as in prod: B2Brouter, played here. */
const real = fakeAdapter({
  provider: 'b2brouter',
  sendInvoice: async () => ({ outcome: 'deposited', pdpRef: `real_${++refs}` }),
  listInbound: async ({ account }) => {
    asked.push(account);
    if (missing.has(account)) throw new Error('404 Not Found: account');
    return [];
  },
});

beforeAll(async () => {
  database = await testDatabase();
});
afterAll(async () => {
  await database.close();
});
beforeEach(() => {
  clock = new Date();
});

const errorCode = async (res: Response) => ((await res.json()) as ErrorBody).error.code;

describe('going live in prod', () => {
  let api: ReturnType<typeof testApi>;
  beforeAll(() => {
    api = testApi(database, { mock: platform, b2brouter: real }, ADMIN_TOKEN, {
      now: () => clock,
      env: { FI_ENV: 'prod' },
    });
  });
  const worker = (): WorkerDeps => ({
    env: api.deps.env,
    db: database.db,
    pdp: { mock: platform, b2brouter: real },
    test: { provider: 'mock', scenarios: null },
    jobs: recordedJobs(),
    ai: api.deps.ai,
    mailer: null,
    now: () => clock,
  });

  it('holds real sends and the real inbox until the switch; Mode test never waits', async () => {
    const c = await newTenant(api.request, { pdpProvider: 'b2brouter', pdpAccount: 'acct-live-1' });
    const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
      api.request(path, { ...init, token: c.apiKey });
    let n = 0;
    const create = async (test: boolean) => {
      const res = await call('/invoices', {
        method: 'POST',
        body: { draft: draft(++n, (d) => (d.number = `L-${n}`)), test },
      });
      return ((await res.json()) as { id: string }).id;
    };
    const me = async () => (await (await call('/me')).json()) as { awaitingGoLive: boolean };

    expect((await me()).awaitingGoLive).toBe(true);
    const invoice = await create(false);
    const held = await call(`/invoices/${invoice}/send`, { method: 'POST' });
    expect(held.status).toBe(409);
    const body = (await held.json()) as ErrorBody;
    expect(body.error).toMatchObject({ code: 'not_live', message: message('api.error.not_live') });
    const test = await create(true);
    expect((await call(`/invoices/${test}/send`, { method: 'POST' })).status).toBe(202);
    asked.length = 0;
    await runInboundPoll(worker());
    expect(asked).not.toContain('acct-live-1');

    const live = (body: unknown) =>
      api.request(`/admin/tenants/${c.id}/live`, { method: 'PUT', token: ADMIN_TOKEN, body });
    expect(await errorCode(await live({ live: true, confirmSiren: '999999999' }))).toBe(
      'confirm_mismatch',
    );
    // No account at the platform yet: nothing changes, the operator reads why.
    missing.add('acct-live-1');
    const refused = await live({ live: true, confirmSiren: '100 000 009' });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as ErrorBody).error).toMatchObject({
      code: 'platform_account_missing',
      details: '404 Not Found: account',
    });
    expect((await me()).awaitingGoLive).toBe(true);

    missing.delete('acct-live-1');
    const opened = await live({ live: true, confirmSiren: '100000009' });
    expect(opened.status).toBe(200);
    expect((await opened.json()) as { liveAt: string | null }).toMatchObject({
      liveAt: clock.toISOString(),
    });
    expect((await me()).awaitingGoLive).toBe(false);
    const sent = await call(`/invoices/${invoice}/send`, { method: 'POST' });
    expect(sent.status).toBe(202);
    await runSend(worker(), invoice);
    asked.length = 0;
    await runInboundPoll(worker());
    expect(asked).toContain('acct-live-1');

    expect((await live({ live: false, confirmSiren: '100000009' })).status).toBe(200);
    expect((await me()).awaitingGoLive).toBe(true);
    const trail = await database.db
      .select({ action: auditEvents.action, actor: auditEvents.actor })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, c.id));
    expect(trail.filter((e) => e.action.startsWith('tenant.'))).toEqual(
      expect.arrayContaining([
        { action: 'tenant.live', actor: 'admin' },
        { action: 'tenant.offline', actor: 'admin' },
      ]),
    );
  });
});

describe('an accounting firm, pilots and trials', () => {
  let api: ReturnType<typeof testApi>;
  beforeAll(() => {
    api = testApi(database, { mock: platform }, ADMIN_TOKEN, { now: () => clock });
  });
  const admin = (path: string, body: unknown) =>
    api.request(path, { method: 'PUT', token: ADMIN_TOKEN, body });

  it("gives a company the firm's brand: the pane gets it, the weekly report comes from the firm", async () => {
    const owner = 'gerant@client-du-cabinet.test';
    const c = await newTenant(api.request, { ownerEmail: owner, pdpAccount: 'acct-brand' });
    const brand = { firmName: 'Cabinet Exemple', accentColor: '#1F4E79', full: true };
    expect(
      (
        await admin(`/admin/tenants/${c.id}/white-label`, {
          whiteLabel: { ...brand, accentColor: 'blue' },
        })
      ).status,
    ).toBe(400);
    const res = await admin(`/admin/tenants/${c.id}/white-label`, { whiteLabel: brand });
    expect(res.status).toBe(200);
    const tenant = (await (await api.request('/tenant', { token: c.apiKey })).json()) as {
      whiteLabel: unknown;
    };
    expect(tenant.whiteLabel).toEqual(brand);

    const today = parisToday();
    clock = paris(addDays(today, 8 - isoWeekday(today)), 9);
    await runWeeklyReports(api.deps);
    const mail = api.mailer.sent.find((m) => m.to === owner);
    expect(mail?.fromName).toBe('Cabinet Exemple');
    expect(mail?.subject).toMatch(/^Votre semaine avec Cabinet Exemple \(/);

    expect((await admin(`/admin/tenants/${c.id}/white-label`, { whiteLabel: null })).status).toBe(
      200,
    );
    const actions = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, c.id));
    expect(actions.filter((a) => a.action === 'tenant.white_label')).toHaveLength(2);
  });

  it('turns a pilot into a trial with a fresh month, never under a running subscription', async () => {
    const c = await newTenant(api.request, { pdpAccount: 'acct-pilot' });
    const res = await admin(`/admin/tenants/${c.id}/billing`, { status: 'trial' });
    expect(res.status).toBe(200);
    const [row] = await database.db.select().from(tenants).where(eq(tenants.id, c.id));
    expect(row?.billingStatus).toBe('trial');
    expect(row?.trialEndsAt?.getTime()).toBe(+clock + 30 * DAY);

    await database.db
      .update(tenants)
      .set({ stripeSubscriptionId: 'sub_test_running' })
      .where(eq(tenants.id, c.id));
    const refused = await admin(`/admin/tenants/${c.id}/billing`, { status: 'trial' });
    expect(await errorCode(refused)).toBe('billing_has_subscription');
    expect((await admin(`/admin/tenants/${c.id}/billing`, { status: 'pilot' })).status).toBe(200);

    const unknown = await admin('/admin/tenants/00000000-0000-4000-8000-000000000000/billing', {
      status: 'pilot',
    });
    expect(await errorCode(unknown)).toBe('tenant_not_found');
    const anonymous = await api.request(`/admin/tenants/${c.id}/billing`, {
      method: 'PUT',
      body: { status: 'pilot' },
    });
    expect(await errorCode(anonymous)).toBe('admin_forbidden');
  });
});

describe('limits', () => {
  it('counts a fixed minute per key', () => {
    let now = 0;
    const windows = new RequestWindows({ public: 2, poll: 2, tenant: 2, admin: 2 }, () => now);
    expect([1, 2, 3].map(() => windows.take('public', 'a'))).toEqual([true, true, false]);
    expect(windows.take('public', 'b')).toBe(true);
    expect(windows.take('poll', 'a')).toBe(true);
    now = 60_000;
    expect(windows.take('public', 'a')).toBe(true);
  });

  it('answers 429 per address behind the trusted proxy, and per company', async () => {
    const api = testApi(database, { mock: platform }, ADMIN_TOKEN, {
      limits: new RequestWindows({ public: 2, poll: 2, tenant: 3, admin: 100 }),
      env: { TRUST_PROXY_HEADER: 'x-forwarded-for' },
    });
    // The proxy appends the address it saw: the last entry counts, not one the client wrote.
    const from = (address: string) => ({
      headers: { 'x-forwarded-for': `203.0.113.250, ${address}` },
    });
    const statuses = async (n: number, init: Parameters<typeof api.request>[1], path: string) => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push((await api.request(path, init)).status);
      return out;
    };
    expect(await statuses(3, from('198.51.100.1'), '/auth/options')).toEqual([200, 200, 429]);
    expect(await statuses(1, from('198.51.100.2'), '/auth/options')).toEqual([200]);
    const refused = await api.request('/auth/options', from('198.51.100.1'));
    expect(((await refused.json()) as ErrorBody).error).toMatchObject({
      code: 'too_many_requests',
      message: message('api.error.too_many_requests'),
    });

    const c = await newTenant(api.request, { pdpAccount: 'acct-limits' });
    expect(await statuses(4, { token: c.apiKey }, '/me')).toEqual([200, 200, 200, 429]);
  });

  it('refuses bodies above the route size with 413', async () => {
    const api = testApi(database, { mock: platform });
    const big = (size: number) => JSON.stringify({ email: 'a@b.test', pad: 'x'.repeat(size) });
    const link = await api.request('/auth/magic-link', { method: 'POST', body: big(300 * 1024) });
    expect(link.status).toBe(413);
    expect(await errorCode(link)).toBe('body_too_large');
    const c = await newTenant(api.request, { pdpAccount: 'acct-body' });
    const invoice = await api.request('/invoices', {
      method: 'POST',
      token: c.apiKey,
      body: big(2 * 1024 * 1024 + 1),
    });
    expect(invoice.status).toBe(413);
  });
});

describe('purge of sign-in data', () => {
  it('removes links, sign-up requests and ended sessions a day after they stop working', async () => {
    const own = await testDatabase();
    const api = testApi(own, { mock: platform }, ADMIN_TOKEN, { now: () => clock });
    try {
      const owner = 'gerante@purge.test';
      const c = await newTenant(api.request, { ownerEmail: owner, pdpAccount: 'acct-purge' });
      // Three days ago: a link, a sign-up never confirmed, a session signed out.
      clock = new Date(Date.now() - 3 * DAY);
      const old = await signIn(api.request, api.mailer, owner);
      await api.request('/auth/logout', { method: 'POST', token: old });
      await api.request('/auth/magic-link', { method: 'POST', body: { email: owner } });
      linkToken(api.mailer, owner);
      const signup = await api.request('/onboarding/signup', {
        method: 'POST',
        body: {
          siren: '999000102',
          email: 'nouveau@purge.test',
          company: { name: 'ENTREPRISE DE DEMONSTRATION 0102', address: null, vatId: null },
          acceptTerms: true,
          termsVersion: TERMS_VERSION,
        },
      });
      expect(signup.status).toBe(202);
      // Now: a session in use, and a link sent an hour ago is kept.
      clock = new Date();
      const current = await signIn(api.request, api.mailer, owner);

      expect(await purgeExpired({ db: own.db, now: () => clock })).toEqual({
        links: 2,
        signups: 1,
        sessions: 1,
      });
      expect(await own.db.select().from(signupRequests)).toEqual([]);
      expect(await own.db.select().from(magicLinks)).toHaveLength(1);
      expect(await own.db.select().from(sessions).where(eq(sessions.tenantId, c.id))).toHaveLength(
        1,
      );
      expect((await api.request('/me', { token: current })).status).toBe(200);
    } finally {
      await own.close();
    }
  });
});
