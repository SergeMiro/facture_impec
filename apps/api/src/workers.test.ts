import type { Database } from '@fi/db';
import {
  and,
  asc,
  auditEvents,
  eq,
  inboundQueue,
  invoiceEvents,
  invoices,
  pdpSubmissions,
} from '@fi/db';
import {
  type PdpAdapter,
  type PdpStatusEvent,
  PdpUnavailableError,
  type SendInput,
} from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  draft,
  fakeAdapter,
  newTenant,
  recordedJobs,
  testAi,
  testApi,
  testDatabase,
} from './test-helpers';
import {
  NotReadyError,
  runInboundPoll,
  runSend,
  runSweep,
  runSync,
  type WorkerDeps,
} from './workers';

let database: Database;
let request: ReturnType<typeof testApi>['request'];

beforeAll(async () => {
  database = await testDatabase();
  ({ request } = testApi(database, { mock: fakeAdapter() }));
});
afterAll(async () => {
  await database.close();
});

const worker = (adapter: PdpAdapter, jobs = recordedJobs()): WorkerDeps => ({
  db: database.db,
  pdp: { mock: adapter },
  test: null,
  jobs,
  ai: testAi(database),
  mailer: null,
  now: () => new Date(),
});

/** A tenant with one invoice the user has just sent: status ready_to_send. */
async function readyInvoice(index = 1) {
  const tenant = await newTenant(request);
  const res = await request('/invoices', {
    method: 'POST',
    token: tenant.apiKey,
    body: { draft: draft(index) },
  });
  const { id } = (await res.json()) as { id: string };
  await request(`/invoices/${id}/send`, { method: 'POST', token: tenant.apiKey });
  return { ...tenant, invoiceId: id };
}

async function invoice(id: string) {
  const [row] = await database.db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) throw new Error('gone');
  return row;
}

async function timeline(id: string) {
  return database.db
    .select()
    .from(invoiceEvents)
    .where(eq(invoiceEvents.invoiceId, id))
    .orderBy(asc(invoiceEvents.id));
}

async function submissions(id: string) {
  return database.db.select().from(pdpSubmissions).where(eq(pdpSubmissions.invoiceId, id));
}

const event = (n: number, status: PdpStatusEvent['status'], raw: string = status) => ({
  id: `evt_${n}`,
  status,
  raw,
  at: `2026-10-15T08:0${n}:00.000Z`,
});

describe('runSend', () => {
  it('deposits the CII with the tenant account and the idempotency key', async () => {
    const { invoiceId, account } = await readyInvoice();
    const calls: SendInput[] = [];
    const adapter = fakeAdapter({
      sendInvoice: async (input) => {
        calls.push(input);
        return { outcome: 'deposited', pdpRef: 'inv_1' };
      },
    });
    await runSend(worker(adapter), invoiceId);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ account, format: 'CII' });
    expect(calls[0]?.xml).toContain('CrossIndustryInvoice');
    const row = await invoice(invoiceId);
    expect(row).toMatchObject({ status: 'deposited', pdpRef: 'inv_1' });
    expect(row.xmlCii).toBe(calls[0]?.xml);
    const [sub] = await submissions(invoiceId);
    expect(sub).toMatchObject({
      status: 'deposited',
      pdpRef: 'inv_1',
      attempts: 1,
      idempotencyKey: calls[0]?.idempotencyKey,
    });
    const events = (await timeline(invoiceId)).map((e) => `${e.event}:${e.actor}`);
    expect(events.slice(-2)).toEqual(['send:system', 'deposited:pdp']);
  });

  it('goes back to ready_to_send on an outage and retries with the same key', async () => {
    const { invoiceId } = await readyInvoice();
    const keys: string[] = [];
    let down = true;
    const adapter = fakeAdapter({
      sendInvoice: async (input) => {
        keys.push(input.idempotencyKey);
        if (down) throw new PdpUnavailableError('503');
        return { outcome: 'deposited', pdpRef: 'inv_2' };
      },
    });
    await expect(runSend(worker(adapter), invoiceId)).rejects.toThrow(PdpUnavailableError);
    expect((await invoice(invoiceId)).status).toBe('ready_to_send');
    expect((await submissions(invoiceId))[0]).toMatchObject({
      status: 'pending',
      lastError: '503',
    });
    down = false;
    await runSend(worker(adapter), invoiceId);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect((await invoice(invoiceId)).status).toBe('deposited');
    expect((await submissions(invoiceId))[0]).toMatchObject({ attempts: 2, lastError: null });
    const interrupted = (await timeline(invoiceId)).find((e) => e.event === 'send_interrupted');
    expect(interrupted?.payload).toMatchObject({ error: '503', retryable: true });
  });

  it('records a platform rejection with its reasons', async () => {
    const { invoiceId } = await readyInvoice();
    const errors = [{ rule: 'BR-FR-01', message: 'Numéro de facture invalide.' }];
    await runSend(
      worker(fakeAdapter({ sendInvoice: async () => ({ outcome: 'rejected', errors }) })),
      invoiceId,
    );
    expect((await invoice(invoiceId)).status).toBe('rejected_by_pdp');
    expect((await submissions(invoiceId))[0]?.status).toBe('rejected');
    const last = (await timeline(invoiceId)).at(-1);
    expect(last).toMatchObject({ event: 'rejected_by_pdp', actor: 'pdp', payload: { errors } });
  });

  it('does nothing for an invoice that is no longer waiting to be sent', async () => {
    const { invoiceId } = await readyInvoice();
    const deposit = fakeAdapter({
      sendInvoice: async () => ({ outcome: 'deposited', pdpRef: 'inv_3' }),
    });
    await runSend(worker(deposit), invoiceId);
    await runSend(worker(fakeAdapter()), invoiceId); // would throw « not scripted » if it called out
    expect((await submissions(invoiceId))[0]?.attempts).toBe(1);
  });
});

describe('runSync', () => {
  async function depositedInvoice(pdpRef: string) {
    const ready = await readyInvoice();
    await runSend(
      worker(fakeAdapter({ sendInvoice: async () => ({ outcome: 'deposited', pdpRef }) })),
      ready.invoiceId,
    );
    return ready;
  }

  it('applies each platform event once, and keeps the ones that change nothing', async () => {
    const { invoiceId, account } = await depositedInvoice('inv_10');
    let history = [event(1, 'deposited'), event(2, 'received_by_platform', 'Reçue')];
    const adapter = fakeAdapter({ getStatus: async () => history });
    const target = { provider: 'mock' as const, account, pdpRef: 'inv_10' };
    await runSync(worker(adapter), target);
    history = [...history, event(3, 'delivered', 'Mise à disposition'), event(4, 'accepted')];
    await runSync(worker(adapter), target);
    await runSync(worker(adapter), target);
    const row = await invoice(invoiceId);
    expect(row).toMatchObject({ status: 'accepted', pdpStatusRaw: 'accepted' });
    const fromPdp = (await timeline(invoiceId)).filter((e) => e.pdpEventId);
    expect(fromPdp.map((e) => [e.pdpEventId, e.type, e.event])).toEqual([
      ['evt_1', 'pdp_event', 'deposited'],
      ['evt_2', 'transition', 'delivered'],
      ['evt_3', 'pdp_event', 'delivered'],
      ['evt_4', 'transition', 'accepted'],
    ]);
  });

  it('keeps a status it does not know on the timeline', async () => {
    const { invoiceId, account } = await depositedInvoice('inv_11');
    const adapter = fakeAdapter({
      getStatus: async () => [event(1, 'deposited'), event(2, 'unknown', 'Suspendue')],
    });
    await runSync(worker(adapter), { provider: 'mock', account, pdpRef: 'inv_11' });
    expect((await invoice(invoiceId)).status).toBe('deposited');
    const last = (await timeline(invoiceId)).at(-1);
    expect(last).toMatchObject({
      type: 'pdp_event',
      event: null,
      payload: { pdpStatus: 'Suspendue' },
    });
  });

  it('waits when the webhook arrives before the deposit answer', async () => {
    const { account } = await readyInvoice();
    const adapter = fakeAdapter({ getStatus: async () => [] });
    await expect(
      runSync(worker(adapter), { provider: 'mock', account, pdpRef: 'inv_unknown' }),
    ).rejects.toThrow(NotReadyError);
  });
});

describe('runSweep', () => {
  it('re-queues unfinished sends and refreshes invoices still awaiting the platform', async () => {
    const ready = await readyInvoice();
    const sent = await readyInvoice();
    await runSend(
      worker(
        fakeAdapter({ sendInvoice: async () => ({ outcome: 'deposited', pdpRef: 'inv_20' }) }),
      ),
      sent.invoiceId,
    );
    const jobs = recordedJobs();
    await runSweep(worker(fakeAdapter(), jobs));
    expect(jobs.sends).toContain(ready.invoiceId);
    expect(jobs.sends).not.toContain(sent.invoiceId);
    expect(jobs.syncs).toContainEqual({
      provider: 'mock',
      account: sent.account,
      pdpRef: 'inv_20',
    });
  });
});

describe('runInboundPoll', () => {
  const supplierInvoice = (n: number) => ({
    pdpRef: `inb_${n}`,
    receivedAt: `2026-10-1${n}T08:00:00.000Z`,
    xml: `<Invoice n="${n}"/>`,
  });

  it('stores each received invoice once, asking from the last one stored', async () => {
    const tenant = await newTenant(request);
    const asked: Date[] = [];
    const received = [supplierInvoice(5)];
    const adapter = fakeAdapter({
      listInbound: async ({ account, since }) => {
        if (account !== tenant.account) return [];
        asked.push(since);
        return received;
      },
    });
    expect((await runInboundPoll(worker(adapter))).stored).toBe(1);
    received.push(supplierInvoice(6));
    expect((await runInboundPoll(worker(adapter))).stored).toBe(1);
    expect(asked[1]?.toISOString()).toBe('2026-10-15T08:00:00.000Z');

    const rows = await database.db
      .select()
      .from(inboundQueue)
      .where(eq(inboundQueue.tenantId, tenant.id))
      .orderBy(asc(inboundQueue.receivedAt));
    expect(rows.map((r) => [r.pdpRef, r.provider, r.status, r.xml])).toEqual([
      ['inb_5', 'mock', 'new', '<Invoice n="5"/>'],
      ['inb_6', 'mock', 'new', '<Invoice n="6"/>'],
    ]);
    const audited = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenant.id), eq(auditEvents.action, 'inbound_received')));
    expect(audited).toHaveLength(2);
  });

  it('goes on when one platform fails, and logs which one', async () => {
    const down = await newTenant(request);
    const up = await newTenant(request);
    const adapter = fakeAdapter({
      listInbound: async ({ account }) => {
        if (account === down.account) throw new PdpUnavailableError('down');
        return account === up.account ? [supplierInvoice(7)] : [];
      },
    });
    const logs: string[] = [];
    const result = await runInboundPoll(worker(adapter), (m) => logs.push(m));
    expect(result).toEqual({ stored: 1, failed: 1 });
    expect(logs).toEqual([expect.stringContaining(down.account)]);
  });
});

describe('Mode test routing', () => {
  it('sends a test invoice to the test platform, whatever platform the tenant uses', async () => {
    const real = fakeAdapter({
      provider: 'b2brouter',
      sendInvoice: async () => {
        throw new Error('a test invoice reached the real platform');
      },
    });
    const testCalls: SendInput[] = [];
    const sandbox = fakeAdapter({
      sendInvoice: async (input) => {
        testCalls.push(input);
        return { outcome: 'deposited', pdpRef: 'inv_test_1' };
      },
      getStatus: async () => [event(1, 'deposited'), event(2, 'rejected')],
    });
    const pdp = { mock: sandbox, b2brouter: real };
    const local = testApi(database, pdp).request;
    const tenant = await newTenant(local, { pdpProvider: 'b2brouter' });
    const res = await local('/invoices', {
      method: 'POST',
      token: tenant.apiKey,
      body: { draft: draft(1), test: true },
    });
    const { id, number } = (await res.json()) as { id: string; number: string };
    expect(number).toMatch(/^TEST-/);
    await local(`/invoices/${id}/send`, { method: 'POST', token: tenant.apiKey });

    const deps: WorkerDeps = {
      ...worker(sandbox),
      pdp,
      test: { provider: 'mock', scenarios: null },
    };
    await runSend(deps, id);
    expect(testCalls).toHaveLength(1);
    const [sub] = await submissions(id);
    expect(sub).toMatchObject({ provider: 'mock', pdpRef: 'inv_test_1' });

    // The sweep and the sync look for it on the test platform too.
    const jobs = recordedJobs();
    await runSweep({ ...deps, jobs });
    const target = jobs.syncs.find((s) => s.pdpRef === 'inv_test_1');
    expect(target).toMatchObject({ provider: 'mock', account: tenant.account });
    if (!target) throw new Error('no sync');
    await runSync(deps, target);
    expect((await invoice(id)).status).toBe('rejected_by_pdp');

    // Without a test platform it waits instead of going anywhere else.
    const ready = await local('/invoices', {
      method: 'POST',
      token: tenant.apiKey,
      body: { draft: draft(2), test: true },
    });
    const second = ((await ready.json()) as { id: string }).id;
    const refused = await testApi(database, pdp, undefined, { test: null }).request(
      `/invoices/${second}/send`,
      { method: 'POST', token: tenant.apiKey },
    );
    expect(refused.status).toBe(409);
  });
});
