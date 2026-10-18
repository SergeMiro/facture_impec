// Shared by the API tests: an in-memory database, recorded jobs, a tenant with its key.
import { type InvoiceDraft, parisHour, parisToday } from '@fi/core';
import { bundledFonts } from '@fi/core/fonts';
import { type Database, openDatabase } from '@fi/db';
import type { PdpAdapter } from '@fi/pdp-adapter';
import { createAiDeps } from './ai';
import { createApp } from './app';
import type { ApiDeps, Jobs, PdpRegistry, SyncTarget } from './deps';
import { OutboxMailer } from './mail';
import { SCENARIO_SELLER, scenarioDraft } from './scenarios/invoice';

import { runSend, runSync, type WorkerDeps } from './workers';

// The task pane's tests move invoices as the workers would.
export { runCollect } from './collect';
export { runSend, runSync, type WorkerDeps };

export const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';

export interface RecordedJobs extends Jobs {
  sends: string[];
  syncs: SyncTarget[];
  monitors: string[];
  payments: string[];
}

export function recordedJobs(): RecordedJobs {
  const sends: string[] = [];
  const syncs: SyncTarget[] = [];
  const monitors: string[] = [];
  const payments: string[] = [];
  return {
    sends,
    syncs,
    monitors,
    payments,
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
  };
}

export async function testDatabase(): Promise<Database> {
  const database = await openDatabase();
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
  overrides: Partial<Omit<ApiDeps, 'env' | 'db' | 'jobs' | 'pdp'>> = {},
) {
  const jobs = recordedJobs();
  // Stamped with the business clock, as in the API process.
  const mailer = new OutboxMailer(undefined, () => deps.now());
  const deps: ApiDeps = {
    env: {
      FI_ENV: 'local',
      ADMIN_TOKEN: adminToken ?? undefined,
      API_PUBLIC_URL: 'http://localhost:4000',
      ADDIN_ORIGINS: ['https://localhost:3000'],
    },
    db: database.db,
    jobs,
    pdp,
    test: pdp.mock ? { provider: 'mock', scenarios: null } : null,
    ai: testAi(database),
    mailer,
    fonts: FONTS,
    now: () => new Date(),
    ...overrides,
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
