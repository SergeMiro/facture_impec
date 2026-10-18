// Billing against the Stripe stand-in (apps/mock-pdp /stripe), in-process: the trial's limits,
// Checkout and its webhooks, the quota and meter events, the portal, cancellation on deletion.
import { createHmac } from 'node:crypto';
import type { Database } from '@fi/db';
import { billingUsage, eq, invoices, stripeEvents, tenants } from '@fi/db';
import { StripeStandIn } from '@fi/mock-pdp';
import { TRIAL_DAYS, TRIAL_REAL_SENDS } from '@fi/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Billing, recordUsage, runUsageReport } from './billing';
import { StripeApi, verifyStripeSignature } from './stripe';
import {
  ADMIN_TOKEN,
  draft,
  fakeAdapter,
  newTenant,
  recordedJobs,
  runSend,
  testApi,
  testDatabase,
  type WorkerDeps,
} from './test-helpers';

const SECRET = 'whsec_test-billing-secret';
const DAY = 86_400_000;

let database: Database;
let api: ReturnType<typeof testApi>;
let stripe: StripeStandIn;
let clock = new Date();
let refs = 0;

/** Requests to `http://host/path` answered by an in-process Hono app. */
const through =
  (app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }) =>
  async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    return app.request(`${u.pathname}${u.search}`, init);
  };

const platform = fakeAdapter({
  sendInvoice: async () => ({ outcome: 'deposited', pdpRef: `bill_${++refs}` }),
});

let billing: Billing;

beforeAll(async () => {
  database = await testDatabase();
  stripe = new StripeStandIn({
    webhookSecret: SECRET,
    webhookUrl: 'http://api.test/webhooks/stripe',
    fetcher: through({ request: (path, init) => api.app.request(path, init) }),
    now: () => clock,
  });
  billing = {
    stripe: new StripeApi('sk_test_billing', 'http://stripe.test', through(stripe.app)),
    webhookSecret: SECRET,
    prices: {
      'essentiel:month': ['price_essentiel_month', 'price_overage_essentiel'],
      'croissance:year': ['price_croissance_year'],
    },
    meterEvent: 'facture_envoyee',
    automaticTax: false,
  };
  api = testApi(database, { mock: platform }, ADMIN_TOKEN, { billing, now: () => clock });
});
afterAll(async () => {
  await database.close();
});
beforeEach(() => {
  clock = new Date();
});

const worker = (): WorkerDeps => ({
  db: database.db,
  pdp: { mock: platform },
  test: { provider: 'mock', scenarios: null },
  jobs: recordedJobs(),
  ai: api.deps.ai,
  mailer: null,
  billing,
  now: () => clock,
});

async function company(billingStatus: 'trial' | 'pilot' = 'trial') {
  const t = await newTenant(api.request, { billing: billingStatus });
  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await api.request(path, { ...init, token: t.apiKey });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  let n = 0;
  /** Creates and sends one invoice; the send job deposits it. */
  const send = async (test = false) => {
    const made = await call('/invoices', {
      method: 'POST',
      body: { draft: draft(++n, (d) => (d.number = `B-${t.id.slice(0, 6)}-${n}`)), test },
    });
    const id = made.body.id as string;
    const sent = await call(`/invoices/${id}/send`, { method: 'POST' });
    if (sent.status === 202) await runSend(worker(), id);
    return sent;
  };
  return { ...t, call, send };
}

const row = async (id: string) =>
  (await database.db.select().from(tenants).where(eq(tenants.id, id)))[0];

/** Opens Checkout as the owner and pays on the stand-in's page. */
async function subscribe(c: Awaited<ReturnType<typeof company>>, plan = 'essentiel') {
  const res = await c.call('/billing/checkout', {
    method: 'POST',
    body: { plan, interval: plan === 'essentiel' ? 'month' : 'year' },
  });
  expect(res.status).toBe(200);
  const session = [...stripe.sessions.values()].find((s) => s.client_reference_id === c.id);
  if (!session) throw new Error('no session');
  await stripe.pay(session.id);
  return session;
}

describe('the trial', () => {
  it(`allows ${TRIAL_REAL_SENDS} real invoices in ${TRIAL_DAYS} days, test ones without limit`, async () => {
    const c = await company();
    expect((await row(c.id))?.trialEndsAt?.getTime()).toBeCloseTo(+clock + TRIAL_DAYS * DAY, -4);
    for (let i = 0; i < TRIAL_REAL_SENDS; i++) expect((await c.send()).status).toBe(202);
    const refused = await c.send();
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { code: 'trial_sends_used' } });
    expect(JSON.stringify(refused.body)).toContain('10');
    expect((await c.send(true)).status).toBe(202);
    const view = (await c.call('/billing')).body;
    expect(view).toMatchObject({ enabled: true, status: 'trial', trial: { sends: 10, left: 0 } });
    expect(view.month).toMatchObject({ sent: 10, included: null });
  }, 60_000);

  it('ends after its 30 days: real sends wait for a plan, the invoice stays ready', async () => {
    const c = await company();
    clock = new Date(Date.now() + (TRIAL_DAYS + 1) * DAY);
    const refused = await c.send();
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'billing_required' } } });
    expect((await c.call('/billing')).body).toMatchObject({ status: 'ended', trial: null });
    expect((await c.send(true)).status).toBe(202);
  });

  it('never applies to a pilot company, which cannot buy a plan either', async () => {
    const c = await company('pilot');
    clock = new Date(Date.now() + 90 * DAY);
    expect((await c.send()).status).toBe(202);
    const res = await c.call('/billing/checkout', {
      method: 'POST',
      body: { plan: 'essentiel', interval: 'month' },
    });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'billing_pilot' } } });
  });
});

describe('Checkout and the webhooks', () => {
  it('turns a paid Checkout into an active plan, read back from Stripe', async () => {
    const c = await company();
    const session = await subscribe(c);
    // Quantity on the flat price only; the metered one takes none.
    expect(session.prices).toEqual(['price_essentiel_month', 'price_overage_essentiel']);
    expect(session.subscriptionMetadata).toEqual({ tenant_id: c.id });
    expect(stripe.delivered.slice(-2)).toEqual([
      { type: 'customer.subscription.created', status: 200 },
      { type: 'checkout.session.completed', status: 200 },
    ]);
    const t = await row(c.id);
    expect(t).toMatchObject({
      billingStatus: 'active',
      plan: 'essentiel',
      billingInterval: 'month',
    });
    expect(t?.stripeCustomerId).toMatch(/^cus_test_/);
    expect(t?.billingPeriodEnd).toBeInstanceOf(Date);
    const view = (await c.call('/billing')).body;
    expect(view).toMatchObject({ status: 'active', portal: true, month: { included: 30 } });
    // The view never shows Stripe's ids.
    expect(JSON.stringify((await c.call('/tenant')).body)).not.toMatch(/cus_test_|sub_test_/);
    const again = await c.call('/billing/checkout', {
      method: 'POST',
      body: { plan: 'essentiel', interval: 'month' },
    });
    expect(again).toMatchObject({
      status: 409,
      body: { error: { code: 'billing_has_subscription' } },
    });
  });

  it('follows a failed payment and a cancellation; the trial left comes back', async () => {
    const c = await company();
    await subscribe(c);
    const sub = (await row(c.id))?.stripeSubscriptionId ?? '';
    await stripe.setStatus(sub, 'past_due');
    expect((await row(c.id))?.billingStatus).toBe('past_due');
    // Stripe is retrying: sends go on, the pane warns.
    expect((await c.send()).status).toBe(202);
    await stripe.setStatus(sub, 'canceled');
    expect((await row(c.id))?.billingStatus).toBe('trial');
  });

  it('refuses an unsigned or stale webhook, and applies an event once', async () => {
    const body = JSON.stringify({
      id: 'evt_test_once',
      type: 'invoice.paid',
      data: { object: {} },
    });
    const sign = (at: Date) => {
      const t = Math.floor(+at / 1000);
      return `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
    };
    const post = (signature: string) =>
      api.request('/webhooks/stripe', {
        method: 'POST',
        body,
        headers: { 'stripe-signature': signature },
      });
    expect((await post('t=1,v1=00')).status).toBe(400);
    expect((await post(sign(new Date(+clock - 10 * 60_000)))).status).toBe(400);
    expect(await (await post(sign(clock))).json()).toEqual({ applied: true });
    expect(await (await post(sign(clock))).json()).toEqual({ applied: false });
    const seen = await database.db
      .select()
      .from(stripeEvents)
      .where(eq(stripeEvents.id, 'evt_test_once'));
    expect(seen).toHaveLength(1);
  });

  it('verifies signatures as Stripe documents them: any v1, hex, 5 minutes', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const t = Math.floor(+now / 1000);
    const good = createHmac('sha256', SECRET).update(`${t}.{}`).digest('hex');
    const other = createHmac('sha256', 'whsec_old').update(`${t}.{}`).digest('hex');
    expect(verifyStripeSignature(`t=${t},v1=${other},v1=${good}`, '{}', SECRET, now)).toBe(true);
    expect(verifyStripeSignature(`t=${t},v0=${good}`, '{}', SECRET, now)).toBe(false);
    expect(verifyStripeSignature(`t=${t},v1=${good}`, '{ }', SECRET, now)).toBe(false);
    expect(verifyStripeSignature(`t=${t},v1=${good}`, '{}', SECRET, new Date(+now + 301_000))).toBe(
      false,
    );
  });
});

describe('the quota', () => {
  /** An invoice the platform took, counted as runSend counts it. */
  async function sentInvoice(tenantId: string) {
    const [inv] = await database.db
      .insert(invoices)
      .values({ tenantId, draft: {} as never, document: {} as never, fingerprint: 'x' })
      .returning({ id: invoices.id });
    if (!inv) throw new Error('no invoice');
    await database.db.transaction((tx) =>
      recordUsage(tx, { billing }, { id: inv.id, tenantId }, clock),
    );
    return inv.id;
  }

  it('reports each invoice beyond the plan’s 30 as one meter event, once', async () => {
    const c = await company();
    await subscribe(c);
    for (let i = 0; i < 32; i++) await sentInvoice(c.id);
    const usage = await database.db
      .select()
      .from(billingUsage)
      .where(eq(billingUsage.tenantId, c.id));
    expect(usage.filter((u) => u.billable)).toHaveLength(2);
    expect(await runUsageReport({ ...worker(), billing })).toEqual({ reported: 2, failed: 0 });
    expect(await runUsageReport({ ...worker(), billing })).toEqual({ reported: 0, failed: 0 });
    const customer = (await row(c.id))?.stripeCustomerId;
    const events = stripe.meterEvents.filter((e) => e.payload.stripe_customer_id === customer);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event_name: 'facture_envoyee', payload: { value: '1' } });
    expect((await c.call('/billing')).body.month).toMatchObject({
      sent: 32,
      included: 30,
      overage: true,
    });
  });

  it('charges nothing beyond the quota of a plan sold without a metered price', async () => {
    const c = await company();
    await subscribe(c, 'croissance');
    expect(await row(c.id)).toMatchObject({ plan: 'croissance', billingInterval: 'year' });
    for (let i = 0; i < 101; i++) await sentInvoice(c.id);
    const usage = await database.db
      .select()
      .from(billingUsage)
      .where(eq(billingUsage.tenantId, c.id));
    expect(usage.filter((u) => u.billable)).toHaveLength(0);
    expect((await c.call('/billing')).body.month).toMatchObject({ included: 100, overage: false });
  });

  it('counts a real send from the send job, never a test one', async () => {
    const c = await company();
    await c.send();
    await c.send(true);
    const usage = await database.db
      .select()
      .from(billingUsage)
      .where(eq(billingUsage.tenantId, c.id));
    expect(usage).toHaveLength(1);
    expect(usage[0]?.billable).toBe(false);
  });
});

describe('the customer portal and deletion', () => {
  it('opens the portal once there is a customer', async () => {
    const c = await company();
    expect(await c.call('/billing/portal', { method: 'POST' })).toMatchObject({
      status: 409,
      body: { error: { code: 'billing_no_customer' } },
    });
    await subscribe(c);
    const res = await c.call('/billing/portal', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\/portal\/bps_test_/);
  });

  it('ends the subscription when the company deletes its account', async () => {
    const c = await company();
    await subscribe(c);
    const sub = (await row(c.id))?.stripeSubscriptionId ?? '';
    const t = await row(c.id);
    const res = await c.call('/tenant', { method: 'DELETE', body: { confirmSiren: t?.siren } });
    expect(res.status).toBe(200);
    expect(stripe.subscriptions.get(sub)?.status).toBe('canceled');
    expect((await row(c.id))?.billingStatus).toBe('ended');
  });
});
