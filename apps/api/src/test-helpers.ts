// Shared by the API tests: an in-memory database, recorded jobs, a tenant with its key.
import { type InvoiceDraft, parisToday } from '@fi/core';
import { bundledFonts } from '@fi/core/fonts';
import { type Database, openDatabase } from '@fi/db';
import type { PdpAdapter } from '@fi/pdp-adapter';
import { createAiDeps } from './ai';
import { createApp } from './app';
import type { ApiDeps, Jobs, PdpRegistry, SyncTarget } from './deps';
import { OutboxMailer } from './mail';
import { SCENARIO_SELLER, scenarioDraft } from './scenarios/invoice';

// The task pane's tests move invoices as the workers would.
export { runSend, runSync, type WorkerDeps } from './workers';

export const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';

export interface RecordedJobs extends Jobs {
  sends: string[];
  syncs: SyncTarget[];
}

export function recordedJobs(): RecordedJobs {
  const sends: string[] = [];
  const syncs: SyncTarget[] = [];
  return {
    sends,
    syncs,
    async enqueueSend(id) {
      sends.push(id);
    },
    async enqueueSync(target) {
      syncs.push(target);
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
  const mailer = new OutboxMailer();
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
