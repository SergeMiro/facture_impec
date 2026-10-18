import type { Database } from '@fi/db';
import { asc, eq, invoiceEvents, invoices, pdpSubmissions } from '@fi/db';
import {
  type PdpAdapter,
  type PdpStatusEvent,
  PdpUnavailableError,
  type SendInput,
} from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draft, fakeAdapter, newTenant, recordedJobs, testApi, testDatabase } from './test-helpers';
import { NotReadyError, runSend, runSweep, runSync, type WorkerDeps } from './workers';

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
  jobs,
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
