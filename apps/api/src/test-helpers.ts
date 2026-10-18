// Shared by the API tests: an in-memory database, recorded jobs, a tenant with its key.
import { type InvoiceDraft, parisToday } from '@fi/core';
import { type Database, openDatabase } from '@fi/db';
import type { PdpAdapter } from '@fi/pdp-adapter';
import { createApp } from './app';
import type { ApiDeps, Jobs, PdpRegistry, SyncTarget } from './deps';
import { SCENARIO_SELLER, scenarioDraft } from './scenarios/invoice';

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

export function testApi(
  database: Database,
  pdp: PdpRegistry,
  /** `null`: the admin routes are disabled, as on a server without ADMIN_TOKEN. */
  adminToken: string | null = ADMIN_TOKEN,
) {
  const jobs = recordedJobs();
  const deps: ApiDeps = {
    env: { FI_ENV: 'local', ADMIN_TOKEN: adminToken ?? undefined },
    db: database.db,
    jobs,
    pdp,
    now: () => new Date(),
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
  return { app, deps, jobs, request };
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
