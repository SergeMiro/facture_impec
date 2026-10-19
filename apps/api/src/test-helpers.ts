// Shared by the API tests: an in-memory database, recorded jobs, a tenant with its key.
import { type InvoiceDraft, parisHour, parisToday } from '@fi/core';
import { bundledFonts } from '@fi/core/fonts';
import { type Database, type OpenOptions, openDatabase } from '@fi/db';
import { StripeStandIn, sireneStandIn } from '@fi/mock-pdp';
import type { PdpAdapter } from '@fi/pdp-adapter';
import { createAiDeps } from './ai';
import { createApp } from './app';
import type { Billing } from './billing';
import type { ApiDeps, Jobs, PdpRegistry, SyncTarget } from './deps';
import { RequestWindows } from './limits';
import { OutboxMailer } from './mail';
import { SCENARIO_SELLER, scenarioDraft } from './scenarios/invoice';
import { RechercheEntreprises } from './sirene';
import { StripeApi } from './stripe';

import { runSend, runSync, type WorkerDeps } from './workers';

// The SIRENs the directory stand-in plays a case with.
export { SIRENE_CASES } from '@fi/mock-pdp';
// The task pane's tests move invoices as the workers would.
export { runCollect } from './collect';
export { runSend, runSync, type WorkerDeps };

/** `fetch` for `http://any-host/path`, answered by an in-process Hono app. */
export const inProcess =
  (app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }) =>
  async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(url instanceof Request ? url.url : String(url));
    return app.request(`${u.pathname}${u.search}`, init);
  };

/** The company directory, played by the stand-in of apps/mock-pdp (synthetic companies). */
export const testDirectory = () =>
  new RechercheEntreprises('http://sirene.test', inProcess(sireneStandIn()));

export const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';

export const STRIPE_TEST_SECRET = 'whsec_test-billing-secret';

/**
 * Billing against the Stripe stand-in of apps/mock-pdp: monthly Essentiel with its overage price,
 * yearly Croissance without one. `app` is read on each webhook: the API is created after `billing`.
 */
export function standInBilling(
  app: () => { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  now?: () => Date,
): { stripe: StripeStandIn; billing: Billing } {
  const stripe = new StripeStandIn({
    webhookSecret: STRIPE_TEST_SECRET,
    webhookUrl: 'http://api.test/webhooks/stripe',
    fetcher: inProcess({ request: (path, init) => app().request(path, init) }),
    ...(now && { now }),
  });
  const billing: Billing = {
    stripe: new StripeApi('sk_test_billing', 'http://stripe.test', inProcess(stripe.app)),
    webhookSecret: STRIPE_TEST_SECRET,
    prices: {
      'essentiel:month': ['price_essentiel_month', 'price_overage_essentiel'],
      'croissance:year': ['price_croissance_year'],
    },
    meterEvent: 'facture_envoyee',
    automaticTax: false,
  };
  return { stripe, billing };
}

export interface RecordedJobs extends Jobs {
  sends: string[];
  syncs: SyncTarget[];
  monitors: string[];
  payments: string[];
  /** Companies whose registry refresh was queued. */
  registry: string[];
}

export function recordedJobs(): RecordedJobs {
  const sends: string[] = [];
  const syncs: SyncTarget[] = [];
  const monitors: string[] = [];
  const payments: string[] = [];
  const registry: string[] = [];
  return {
    sends,
    syncs,
    monitors,
    payments,
    registry,
    async enqueueSend(id) {
      sends.push(id);
    },
    async enqueueSync(target) {
      syncs.push(target);
    },
    async enqueueMonitor(id) {
      monitors.push(id);
    },
    async enqueueReportPayment(id) {
      payments.push(id);
    },
    async enqueueRegistry(tenantId) {
      registry.push(tenantId);
    },
  };
}

export async function testDatabase(options: Pick<OpenOptions, 'logger'> = {}): Promise<Database> {
  const database = await openDatabase(options);
  await database.migrate();
  return database;
}

export const FONTS = bundledFonts();

/** AI off unless a test passes `included`; the probe fails unless a test scripts it. */
export function testAi(
  database: Database,
  overrides: Partial<Parameters<typeof createAiDeps>[0]> = {},
) {
  return createAiDeps({
    db: database.db,
    now: () => new Date(),
    included: null,
    sealingKey: undefined,
    budget: { runTokens: 50_000, tenantDailyTokens: 1_000_000 },
    probe: async () => ({
      capabilities: { text: false, json: false, tools: false, checkedAt: new Date().toISOString() },
      failure: 'network',
    }),
    ...overrides,
  });
}

export function testApi(
  database: Database,
  pdp: PdpRegistry,
  /** `null`: the admin routes are disabled, as on a server without ADMIN_TOKEN. */
  adminToken: string | null = ADMIN_TOKEN,
  /** Default: the mock as test platform (no scenario port), AI off, an outbox mailer. */
  overrides: Partial<Omit<ApiDeps, 'env' | 'db' | 'jobs' | 'pdp'>> & {
    env?: Partial<ApiDeps['env']>;
  } = {},
) {
  const { env, ...rest } = overrides;
  const jobs = recordedJobs();
  // Stamped with the business clock, as in the API process.
  const mailer = new OutboxMailer(undefined, () => deps.now());
  const deps: ApiDeps = {
    env: {
      FI_ENV: 'local',
      ADMIN_TOKEN: adminToken ?? undefined,
      API_PUBLIC_URL: 'http://localhost:4000',
      ADDIN_ORIGINS: ['https://localhost:3000'],
      ...env,
    },
    db: database.db,
    jobs,
    pdp,
    test: pdp.mock ? { provider: 'mock', scenarios: null } : null,
    ai: testAi(database),
    mailer,
    fonts: FONTS,
    directory: testDirectory(),
    // Tests make more requests a minute than a person; the limits have their own test.
    limits: new RequestWindows({ public: 1e6, poll: 1e6, tenant: 1e6, admin: 1e6 }),
    now: () => new Date(),
    ...rest,
  };
  const app = createApp(deps);
  const request = (
    path: string,
    init: {
      method?: string;
      body?: unknown;
      token?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
        ...(init.token && { authorization: `Bearer ${init.token}` }),
        ...init.headers,
      },
      ...(init.body !== undefined && {
        body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
      }),
    });
  return { app, deps, jobs, mailer, request };
}

let tenants = 0;

/** A new tenant (SIREN of golden invoice 01, its own PDP account) and its API key. */
export async function newTenant(
  request: ReturnType<typeof testApi>['request'],
  extra: Record<string, unknown> = {},
): Promise<{ id: string; apiKey: string; account: string }> {
  const account = `acct-${++tenants}`;
  const res = await request('/admin/tenants', {
    method: 'POST',
    token: ADMIN_TOKEN,
    body: { ...SCENARIO_SELLER, pdpAccount: account, ...extra },
  });
  if (res.status !== 201) throw new Error(`tenant: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { tenant: { id: string }; apiKey: string };
  return { id: body.tenant.id, apiKey: body.apiKey, account };
}

export const draft = (index: number, change: (d: InvoiceDraft) => void = () => {}) => {
  const d = scenarioDraft(index);
  change(d);
  return d;
};

export const today = () => parisToday();

/** The instant `date` at `hour`:30, Europe/Paris: for tests that move the business clock. */
export function paris(date: string, hour: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  for (const offset of [1, 2]) {
    const at = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hour - offset, 30));
    if (parisToday(at) === date && parisHour(at) === hour) return at;
  }
  throw new Error(`no ${hour}:30 on ${date} in Paris`);
}

/** A PdpAdapter whose answers each test scripts. */
export function fakeAdapter(overrides: Partial<PdpAdapter> = {}): PdpAdapter {
  const fail = () => {
    throw new Error('not scripted');
  };
  return {
    provider: 'mock',
    sendInvoice: async () => fail(),
    getStatus: async () => fail(),
    listInbound: async () => [],
    lookupRecipient: async () => null,
    reportPayment: async () => {},
    verifyWebhook: () => false,
    parseWebhook: () => [],
    ...overrides,
  };
}

/** Signs in through the e-mailed link as the task pane does; returns the session token. */
export async function signIn(
  request: ReturnType<typeof testApi>['request'],
  mailer: OutboxMailer,
  email: string,
): Promise<string> {
  const asked = await request('/auth/magic-link', { method: 'POST', body: { email } });
  if (asked.status !== 202) throw new Error(`magic-link: ${asked.status} ${await asked.text()}`);
  const { requestId } = (await asked.json()) as { requestId: string };
  const link = linkToken(mailer, email);
  await request(`/auth/magic-link/confirm?token=${link}`, { method: 'POST' });
  const polled = await request('/auth/magic-link/poll', { method: 'POST', body: { requestId } });
  const body = (await polled.json()) as { status: string; token?: string };
  if (!body.token) throw new Error(`poll: ${polled.status} ${JSON.stringify(body)}`);
  return body.token;
}

/** The token of the last link mailed to this address. */
export function linkToken(mailer: OutboxMailer, email: string): string {
  const mail = mailer.sent.findLast((m) => m.to === email);
  const match = /token=([\w-]+)/.exec(mail?.text ?? '');
  if (!match?.[1]) throw new Error(`no link mailed to ${email}`);
  return match[1];
}

let pdpRefs = 0;

/**
 * Creates the invoice and has a scripted platform take it to `delivered` (made available to the
 * customer), as the send and sync jobs would.
 */
export async function deliveredInvoice(
  api: ReturnType<typeof testApi>,
  tenant: { apiKey: string; account: string },
  invoice: InvoiceDraft,
): Promise<{ id: string; pdpRef: string }> {
  const res = await api.request('/invoices', {
    method: 'POST',
    token: tenant.apiKey,
    body: { draft: invoice },
  });
  const { id } = (await res.json()) as { id: string };
  await api.request(`/invoices/${id}/send`, { method: 'POST', token: tenant.apiKey });
  const pdpRef = `inv_delivered_${++pdpRefs}`;
  const worker = (adapter: PdpAdapter): WorkerDeps => ({
    db: api.deps.db,
    pdp: { mock: adapter },
    test: null,
    jobs: recordedJobs(),
    ai: api.deps.ai,
    mailer: null,
    now: api.deps.now,
  });
  await runSend(
    worker(fakeAdapter({ sendInvoice: async () => ({ outcome: 'deposited', pdpRef }) })),
    id,
  );
  const at = api.deps.now().toISOString();
  const history = [
    { id: `${pdpRef}_1`, status: 'deposited' as const, raw: 'Déposée', at },
    { id: `${pdpRef}_2`, status: 'delivered' as const, raw: 'Mise à disposition', at },
  ];
  await runSync(worker(fakeAdapter({ getStatus: async () => history })), {
    provider: 'mock',
    account: tenant.account,
    pdpRef,
  });
  return { id, pdpRef };
}
