// After a send (plan §4): « Établir un avoir » on a sent invoice, the credit note sent like any
// invoice, the invoice cancelled by it when the platform has it; « Abandonner la créance » on an
// unpaid one past its due date. Every invoice is the golden one, taken to the platform by a script.
import { addDays, parisToday } from '@fi/core';
import type { Database } from '@fi/db';
import { and, asc, auditEvents, chasePlans, eq, invoiceEvents, invoices, tenants } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCollect } from './collect';
import { weekFacts } from './report';
import {
  deliveredInvoice,
  draft,
  fakeAdapter,
  newTenant,
  paris,
  recordedJobs,
  runSend,
  runSync,
  testApi,
  testDatabase,
  type WorkerDeps,
} from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];
let clock = new Date();

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => clock });
  ({ request } = api);
});
afterAll(async () => {
  await database.close();
});

const year = () => parisToday(clock).slice(0, 4);

let refs = 0;
const worker = (): WorkerDeps => ({
  db: database.db,
  pdp: {
    mock: fakeAdapter({
      sendInvoice: async () => ({ outcome: 'deposited', pdpRef: `inv_credit_${++refs}` }),
    }),
  },
  test: { provider: 'mock', scenarios: null },
  jobs: recordedJobs(),
  ai: api.deps.ai,
  mailer: null,
  now: () => clock,
});

interface Detail {
  id: string;
  number: string;
  issueDate: string;
  status: string;
  isTest: boolean;
  payable: number;
  document: { typeCode?: string; dueDate?: string; precedingInvoices?: unknown[] };
  autopilot: { at: string | null };
  credit: {
    of: { id: string; number: string; issueDate: string } | null;
    by: { id: string; number: string; status: string; statusLabel: string } | null;
  };
  events: { type: string; event: string; payload: Record<string, unknown> }[];
}

const detail = async (token: string, id: string) =>
  (await (await request(`/invoices/${id}`, { token })).json()) as Detail;

const creditNote = (token: string, id: string) =>
  request(`/invoices/${id}/credit-note`, { method: 'POST', token });

/** « Envoyer » on the credit note, and the platform takes it. */
async function sendCredit(token: string, id: string) {
  const sent = await request(`/invoices/${id}/send`, { method: 'POST', token });
  expect(sent.status).toBe(202);
  await runSend(worker(), id);
}

async function status(id: string) {
  const [row] = await database.db
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, id));
  return row?.status;
}

const notes = async (id: string, event: string) =>
  database.db
    .select()
    .from(invoiceEvents)
    .where(and(eq(invoiceEvents.invoiceId, id), eq(invoiceEvents.event, event)))
    .orderBy(asc(invoiceEvents.id));

describe('credit notes', () => {
  it('prepares the full credit note of a sent invoice, and cancels the invoice once the platform has it', async () => {
    clock = new Date();
    const t = await newTenant(request);
    const { id } = await deliveredInvoice(api, t, draft(1));
    const original = await detail(t.apiKey, id);

    const made = await creditNote(t.apiKey, id);
    expect(made.status).toBe(201);
    const avoir = (await made.json()) as Detail;
    expect(avoir).toMatchObject({
      number: `AV${year()}-0001`,
      status: 'validated',
      isTest: false,
      payable: original.payable,
      autopilot: { at: null },
      credit: { of: { id, number: original.number }, by: null },
    });
    expect(avoir.document.typeCode).toBe('381');
    expect(avoir.document.dueDate).toBeUndefined();
    expect(avoir.document.precedingInvoices).toEqual([
      { number: original.number, issueDate: original.issueDate },
    ]);
    expect(avoir.events.some((e) => e.event === 'credit_note_of')).toBe(true);

    // A second click opens the same credit note.
    const again = await creditNote(t.apiKey, id);
    expect(again.status).toBe(200);
    expect(((await again.json()) as Detail).id).toBe(avoir.id);

    // Prepared, not sent: the invoice is as it was, and names its credit note.
    const waiting = await detail(t.apiKey, id);
    expect(waiting.status).toBe('delivered');
    expect(waiting.credit.by).toMatchObject({ id: avoir.id, status: 'validated' });
    expect((await notes(id, 'credit_note_drafted'))[0]?.payload).toMatchObject({
      creditNote: avoir.id,
      number: avoir.number,
    });

    await sendCredit(t.apiKey, avoir.id);
    expect(await status(avoir.id)).toBe('deposited');
    const credited = await detail(t.apiKey, id);
    expect(credited.status).toBe('credited');
    expect(credited.credit.by).toMatchObject({ id: avoir.id, status: 'deposited' });
    const moved = credited.events.find((e) => e.event === 'credit_note');
    expect(moved?.payload).toMatchObject({ creditNote: avoir.id, number: avoir.number });

    const audited = await database.db
      .select({
        action: auditEvents.action,
        actor: auditEvents.actor,
        objectId: auditEvents.objectId,
      })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, t.id));
    expect(audited).toContainEqual({
      action: 'invoice.credit_note',
      actor: 'system',
      objectId: id,
    });
    expect(audited).toContainEqual({ action: 'invoice.create', actor: 'user', objectId: avoir.id });

    // Cancelled for good: no second credit note, and the next invoice's credit note is numbered on.
    expect((await creditNote(t.apiKey, id)).status).toBe(200);
    const other = await deliveredInvoice(
      api,
      t,
      draft(1, (d) => (d.number = 'F2026-0043')),
    );
    const second = (await (await creditNote(t.apiKey, other.id)).json()) as Detail;
    expect(second.number).toBe(`AV${year()}-0002`);

    // The week's report counts the two invoices sent, not the credit note.
    const [company] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    if (!company) throw new Error('no tenant');
    const week = await weekFacts(api.deps, company, clock);
    expect(week.sent).toEqual({ count: 2, amount: 2 * original.payable });
  });

  it('puts a refused invoice « en litige » with its credit note, then cancels it', async () => {
    clock = new Date();
    const t = await newTenant(request);
    const { id, pdpRef } = await deliveredInvoice(api, t, draft(1));
    await runSync(
      {
        ...worker(),
        pdp: {
          mock: fakeAdapter({
            getStatus: async () => [
              {
                id: `${pdpRef}_3`,
                status: 'refused' as const,
                raw: 'Refusée',
                at: new Date().toISOString(),
                reason: { code: 'DOUBLON', text: 'Déjà reçue' },
              },
            ],
          }),
        },
      },
      { provider: 'mock', account: t.account, pdpRef },
    );
    expect(await status(id)).toBe('refused_by_customer');

    const avoir = (await (await creditNote(t.apiKey, id)).json()) as Detail;
    expect(await status(id)).toBe('disputed');
    await sendCredit(t.apiKey, avoir.id);
    expect(await status(id)).toBe('credited');
  });

  it('numbers a test credit note in the test series', async () => {
    clock = new Date();
    const t = await newTenant(request);
    const res = await request('/invoices', {
      method: 'POST',
      token: t.apiKey,
      body: { draft: draft(1), test: true },
    });
    const { id } = (await res.json()) as { id: string };
    await request(`/invoices/${id}/send`, { method: 'POST', token: t.apiKey });
    await runSend(worker(), id);
    expect(await status(id)).toBe('deposited');

    const avoir = (await (await creditNote(t.apiKey, id)).json()) as Detail;
    expect(avoir).toMatchObject({ number: `TEST-AV${year()}-0001`, isTest: true });
    expect(avoir.document.precedingInvoices).toEqual([
      expect.objectContaining({ number: expect.stringMatching(/^TEST-F2026-/) }),
    ]);
    await sendCredit(t.apiKey, avoir.id);
    expect(await status(id)).toBe('credited');
  });

  it('makes one credit note when asked twice at once, and frees it when the draft is cancelled', async () => {
    clock = new Date();
    const t = await newTenant(request);
    const { id } = await deliveredInvoice(api, t, draft(1));
    const both = await Promise.all([creditNote(t.apiKey, id), creditNote(t.apiKey, id)]);
    const ids = await Promise.all(both.map(async (r) => ((await r.json()) as Detail).id));
    expect(new Set(ids).size).toBe(1);
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);

    const cancelled = await request(`/invoices/${ids[0]}/cancel`, {
      method: 'POST',
      token: t.apiKey,
    });
    expect(cancelled.status).toBe(200);
    expect((await detail(t.apiKey, id)).credit.by).toBeNull();
    const fresh = await creditNote(t.apiKey, id);
    expect(fresh.status).toBe(201);
    expect(((await fresh.json()) as Detail).number).toBe(`AV${year()}-0001`);
  });

  it('says plainly why an invoice gets no credit note', async () => {
    clock = new Date();
    const t = await newTenant(request);
    const created = await request('/invoices', {
      method: 'POST',
      token: t.apiKey,
      body: { draft: draft(1) },
    });
    const { id: unsent } = (await created.json()) as { id: string };
    const notSent = await creditNote(t.apiKey, unsent);
    expect(notSent.status).toBe(409);
    expect(await notSent.json()).toMatchObject({ error: { code: 'credit_not_sent' } });

    const { id: paid } = await deliveredInvoice(
      api,
      t,
      draft(1, (d) => (d.number = 'F2026-0050')),
    );
    await request(`/invoices/${paid}/payment`, { method: 'POST', token: t.apiKey, body: {} });
    const refused = await creditNote(t.apiKey, paid);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('credit_paid');
    expect(body.error.message).toContain('rembourser');

    const { id: sent } = await deliveredInvoice(
      api,
      t,
      draft(1, (d) => (d.number = 'F2026-0051')),
    );
    const avoir = (await (await creditNote(t.apiKey, sent)).json()) as Detail;
    const ofAvoir = await creditNote(t.apiKey, avoir.id);
    expect(await ofAvoir.json()).toMatchObject({ error: { code: 'credit_of_credit' } });
  });

  it('leaves an invoice paid meanwhile as it is, and says so on its timeline', async () => {
    clock = new Date();
    const t = await newTenant(request);
    const { id } = await deliveredInvoice(api, t, draft(1));
    const avoir = (await (await creditNote(t.apiKey, id)).json()) as Detail;
    await request(`/invoices/${id}/payment`, { method: 'POST', token: t.apiKey, body: {} });
    await sendCredit(t.apiKey, avoir.id);
    expect(await status(id)).toBe('paid');
    expect((await notes(id, 'credit_note_not_applied'))[0]?.payload).toMatchObject({
      number: avoir.number,
      status: 'paid',
    });
  });
});

describe('write-off', () => {
  it('gives up an unpaid invoice past its due date and ends its chasing', async () => {
    clock = new Date();
    const t = await newTenant(request);
    const due = addDays(parisToday(), 10);
    const { id } = await deliveredInvoice(
      api,
      t,
      draft(1, (d) => {
        d.dueDate = due;
      }),
    );
    const early = await request(`/invoices/${id}/write-off`, { method: 'POST', token: t.apiKey });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: 'cannot_write_off' } });

    clock = paris(addDays(due, 1), 10);
    await runCollect({ db: database.db, mailer: null, now: () => clock });
    expect(['overdue', 'chasing']).toContain(await status(id));

    const res = await request(`/invoices/${id}/write-off`, { method: 'POST', token: t.apiKey });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Detail).status).toBe('written_off');
    const [plan] = await database.db.select().from(chasePlans).where(eq(chasePlans.invoiceId, id));
    expect(plan?.nextStepOn).toBeNull();
    expect(plan?.steps.some((s) => s.status === 'pending')).toBe(false);
    // Asked again: nothing changes.
    expect(
      (await request(`/invoices/${id}/write-off`, { method: 'POST', token: t.apiKey })).status,
    ).toBe(200);
  });
});
