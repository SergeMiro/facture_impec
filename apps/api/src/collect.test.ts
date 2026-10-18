// Chasing (plan §6 CollectAgent, §11 M5): the overdue run, the plan of each invoice, the step of the
// day as a draft or, in Autopilot, an e-mail, and what the user does on « Relancer ». The business
// clock is moved by hand; every invoice is the golden one, delivered through a scripted platform.
import { addDays, type ChaseStep, parisToday } from '@fi/core';
import type { Database } from '@fi/db';
import { asc, auditEvents, chasePlans, eq, invoiceEvents, invoices, paymentReports } from '@fi/db';
import { PdpUnavailableError } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCollect, SENDING_STALE_MS } from './collect';
import type { Mailer } from './deps';
import { runReportPayment } from './payments';
import {
  deliveredInvoice,
  draft,
  fakeAdapter,
  newTenant,
  paris,
  recordedJobs,
  runSync,
  testAi,
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

const worker = (adapter = fakeAdapter()): WorkerDeps => ({
  db: database.db,
  pdp: { mock: adapter },
  test: null,
  jobs: recordedJobs(),
  ai: testAi(database),
  mailer: null,
  now: () => clock,
});

const collect = (mailer: Mailer | null = api.mailer) =>
  runCollect({ db: database.db, mailer, now: () => clock });

/** An invoice the platform has made available to the customer: delivered, due on `due`. */
async function delivered(
  tenant: { apiKey: string; account: string },
  due: string,
  email: string | null,
  index = 1,
) {
  clock = new Date();
  const { id } = await deliveredInvoice(
    api,
    tenant,
    draft(index, (d) => {
      d.dueDate = due;
      if (email) d.buyer.contact = { email };
    }),
  );
  expect((await invoice(id)).status).toBe('delivered');
  return id;
}

async function invoice(id: string) {
  const [row] = await database.db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) throw new Error('gone');
  return row;
}

async function plan(id: string) {
  const [row] = await database.db.select().from(chasePlans).where(eq(chasePlans.invoiceId, id));
  if (!row) throw new Error('no plan');
  return row;
}

const step = async (id: string, offset: number) => {
  const found = (await plan(id)).steps.find((s) => s.offset === offset);
  if (!found) throw new Error(`no step ${offset}`);
  return found;
};

const shape = (s: ChaseStep) => [s.offset, s.status, s.reason];

async function timeline(id: string) {
  return database.db
    .select()
    .from(invoiceEvents)
    .where(eq(invoiceEvents.invoiceId, id))
    .orderBy(asc(invoiceEvents.id));
}

const mailsTo = (email: string) => api.mailer.sent.filter((m) => m.to === email);

const autopilot = (apiKey: string, autopilotMaxAmount = 10_000_000) =>
  request('/settings', {
    method: 'PATCH',
    token: apiKey,
    body: { mode: 'autopilot', autopilotMaxAmount },
  });

const due = () => addDays(parisToday(), 10);

describe('the chasing run', () => {
  it('plans the reminders, marks the invoice overdue the next day, and drafts each step from 9:00', async () => {
    const t = await newTenant(request);
    const d = due();
    const id = await delivered(t, d, 'compta@boulangerie-martin.test');

    clock = paris(addDays(d, -3), 8);
    await collect();
    const planned = await plan(id);
    expect(planned.steps.map((s) => [s.offset, s.kind, s.date, s.status])).toEqual([
      [-3, 'courtesy', addDays(d, -3), 'pending'],
      [1, 'reminder', addDays(d, 1), 'pending'],
      [8, 'reminder', addDays(d, 8), 'pending'],
      [15, 'firm', addDays(d, 15), 'pending'],
      [30, 'formal_notice', addDays(d, 30), 'pending'],
    ]);
    expect(planned.nextStepOn).toBe(addDays(d, -3));

    // From 9:00 on its day, Review mode: a draft that says why it was not sent.
    clock = paris(addDays(d, -3), 9);
    await collect();
    const courtesy = await step(id, -3);
    expect(shape(courtesy)).toEqual([-3, 'drafted', 'review']);
    expect(courtesy.draft).toMatchObject({ to: 'compta@boulangerie-martin.test' });
    expect(courtesy.draft?.subject).toContain((await invoice(id)).number ?? '?');
    expect(mailsTo('compta@boulangerie-martin.test')).toEqual([]);

    // The due date itself is not late; the day after is, on the business clock.
    clock = paris(d, 23);
    await collect();
    expect((await invoice(id)).status).toBe('delivered');
    clock = paris(addDays(d, 1), 8);
    await collect();
    expect((await invoice(id)).status).toBe('overdue');
    const overdue = (await timeline(id)).find((e) => e.event === 'overdue');
    expect(overdue?.at.toISOString()).toBe(clock.toISOString());
    expect(shape(await step(id, 1))).toEqual([1, 'pending', null]);

    clock = paris(addDays(d, 1), 9);
    await collect();
    expect((await invoice(id)).status).toBe('chasing');
    const steps = (await plan(id)).steps;
    // The courtesy draft nobody sent is not sent late: the reminder replaces it.
    expect(steps.slice(0, 2).map(shape)).toEqual([
      [-3, 'skipped', 'superseded'],
      [1, 'drafted', 'review'],
    ]);
    const notes = (await timeline(id)).filter((e) => e.type === 'note' && e.event === 'chase');
    expect(notes.map((n) => [n.payload.offset, n.payload.status])).toEqual([
      [-3, 'drafted'],
      [1, 'drafted'],
    ]);
  });

  it('acts once on a step whose day has come, whatever the number of runs', async () => {
    const t = await newTenant(request);
    const d = due();
    const id = await delivered(t, d, 'achats@client-unique.test');
    clock = paris(addDays(d, 8), 10);
    await collect();
    await collect();
    await collect();
    const notes = (await timeline(id)).filter((e) => e.type === 'note' && e.event === 'chase');
    expect(notes).toHaveLength(1);
    // Days without a run: only the latest step that came is acted on, the earlier ones are skipped.
    expect((await plan(id)).steps.slice(0, 3).map(shape)).toEqual([
      [-3, 'skipped', 'superseded'],
      [1, 'skipped', 'superseded'],
      [8, 'drafted', 'review'],
    ]);
  });

  it('in Autopilot, sends the courtesy, reminder and firm e-mails itself, never the formal notice', async () => {
    const t = await newTenant(request);
    expect((await autopilot(t.apiKey)).status).toBe(200);
    const email = 'paiement@autopilote.test';
    const d = due();
    const id = await delivered(t, d, email);
    for (const offset of [-3, 1, 8, 15, 30]) {
      clock = paris(addDays(d, offset), 10);
      await collect();
    }
    const steps = (await plan(id)).steps;
    expect(steps.map((s) => [s.offset, s.status, s.by, s.reason])).toEqual([
      [-3, 'sent', 'agent', null],
      [1, 'sent', 'agent', null],
      [8, 'sent', 'agent', null],
      [15, 'sent', 'agent', null],
      [30, 'drafted', null, 'formal_notice'],
    ]);
    const mails = mailsTo(email);
    expect(mails).toHaveLength(4);
    expect(mails.some((m) => /mise en demeure/i.test(m.subject + m.text))).toBe(false);
    expect(steps[4]?.draft?.subject).toMatch(/^Mise en demeure/);
    // Each e-mail went out on its own day, business time.
    expect(mails.map((m) => parisToday(new Date(m.at)))).toEqual(
      [-3, 1, 8, 15].map((o) => addDays(d, o)),
    );
    const sent = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.objectId, id));
    expect(sent.filter((a) => a.action === 'chase.sent')).toHaveLength(4);
  });

  it('leaves the e-mail to the user above the ceiling, without an address, or without mail', async () => {
    const d = due();
    const capped = await newTenant(request);
    const big = await delivered(capped, d, 'grosse@facture.test');
    const payable = (await invoice(big)).payable ?? 0;
    expect((await autopilot(capped.apiKey, payable - 1)).status).toBe(200);
    const open = await newTenant(request);
    expect((await autopilot(open.apiKey)).status).toBe(200);
    const anonymous = await delivered(open, d, null);
    clock = paris(addDays(d, 1), 10);
    await collect();
    expect(shape(await step(big, 1))).toEqual([1, 'drafted', 'ceiling']);
    expect(shape(await step(anonymous, 1))).toEqual([1, 'drafted', 'no_recipient']);
    expect((await step(anonymous, 1)).draft?.to).toBeNull();
    expect(mailsTo('grosse@facture.test')).toEqual([]);

    const unmailed = await delivered(open, d, 'sans@serveur-mail.test', 2);
    clock = paris(addDays(d, 1), 10);
    await collect(null);
    expect(shape(await step(unmailed, 1))).toEqual([1, 'drafted', 'no_mailer']);
  });

  it('turns a failed send into a draft, and never sends twice a send that was cut short', async () => {
    const t = await newTenant(request);
    expect((await autopilot(t.apiKey)).status).toBe(200);
    const d = due();
    const failing = await delivered(t, d, 'panne@smtp.test', 1);
    clock = paris(addDays(d, 1), 10);
    const run = await collect({
      send: async () => {
        throw new Error('SMTP 451');
      },
    });
    expect(run.failed).toBeGreaterThanOrEqual(1);
    expect(shape(await step(failing, 1))).toEqual([1, 'drafted', 'send_failed']);

    // A process that stopped between claiming the step and the mail service's answer.
    const cut = await delivered(t, d, 'coupure@process.test', 2);
    clock = paris(addDays(d, -3), 10);
    await collect(null);
    const row = await plan(cut);
    await database.db
      .update(chasePlans)
      .set({
        steps: row.steps.map((s) => (s.offset === -3 ? { ...s, status: 'sending' } : s)),
        updatedAt: new Date(Date.now() - SENDING_STALE_MS - 1_000),
      })
      .where(eq(chasePlans.id, row.id));
    await collect();
    expect(shape(await step(cut, -3))).toEqual([-3, 'drafted', 'send_unknown']);
    expect(mailsTo('coupure@process.test')).toEqual([]);
  });

  it('pauses on a customer refusal', async () => {
    const t = await newTenant(request);
    const d = due();
    const id = await delivered(t, d, 'refus@client.test');
    clock = paris(addDays(d, -3), 10);
    await collect();
    const { pdpRef } = await invoice(id);
    await runSync(
      worker(
        fakeAdapter({
          getStatus: async () => [
            {
              id: `${pdpRef}_3`,
              status: 'refused',
              raw: 'Refusée',
              at: clock.toISOString(),
            },
          ],
        }),
      ),
      { provider: 'mock', account: t.account, pdpRef: pdpRef ?? '' },
    );
    expect((await invoice(id)).status).toBe('refused_by_customer');
    clock = paris(addDays(d, 8), 10);
    await collect();
    const paused = await plan(id);
    expect(paused.paused).toBe(true);
    expect(paused.steps.map((s) => s.status)).toEqual([
      'drafted',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('follows a new cadence for the steps still to come', async () => {
    const t = await newTenant(request);
    const d = due();
    const id = await delivered(t, d, 'cadence@client.test');
    clock = paris(addDays(d, -3), 10);
    await collect();
    await request('/settings', {
      method: 'PATCH',
      token: t.apiKey,
      body: { chaseCadence: [-3, 5, 20] },
    });
    await collect();
    const row = await plan(id);
    expect(row.cadence).toEqual([-3, 5, 20]);
    expect(row.steps.map((s) => [s.offset, s.status])).toEqual([
      [-3, 'drafted'],
      [5, 'pending'],
      [20, 'pending'],
    ]);
    expect(row.nextStepOn).toBe(addDays(d, 5));
  });
});

describe('Relancer', () => {
  it('prepares a draft now in the tone of the delay, and records that the user sent it', async () => {
    const t = await newTenant(request);
    const d = due();
    const id = await delivered(t, d, 'manuel@client.test');
    clock = paris(d, 7);
    await collect();
    clock = paris(addDays(d, 4), 7);
    const prepared = await request(`/invoices/${id}/chase`, { method: 'POST', token: t.apiKey });
    expect(prepared.status).toBe(200);
    const body = (await prepared.json()) as { chase: { steps: ChaseStep[] } };
    const manual = body.chase.steps.find((s) => s.offset === 4);
    expect(manual).toMatchObject({ kind: 'reminder', status: 'drafted', reason: 'manual' });
    expect(manual?.draft?.body).toBeTruthy();

    const notDrafted = await request(`/invoices/${id}/chase/steps/8/sent`, {
      method: 'POST',
      token: t.apiKey,
    });
    expect(notDrafted.status).toBe(409);
    for (let i = 0; i < 2; i++) {
      const sent = await request(`/invoices/${id}/chase/steps/4/sent`, {
        method: 'POST',
        token: t.apiKey,
      });
      expect(sent.status).toBe(200);
    }
    expect(await step(id, 4)).toMatchObject({ status: 'sent', by: 'user' });
    const notes = (await timeline(id)).filter((e) => e.event === 'chase' && e.actor === 'user');
    expect(notes).toHaveLength(2);
  });

  it('holds every step until the day after a payment promise', async () => {
    const t = await newTenant(request);
    const d = due();
    const id = await delivered(t, d, 'promesse@client.test');
    clock = paris(addDays(d, 2), 10);
    await collect();
    const promise = (until: string | null) =>
      request(`/invoices/${id}/promise`, { method: 'POST', token: t.apiKey, body: { until } });
    expect((await promise(addDays(d, 1))).status).toBe(400);
    expect((await promise(addDays(d, 10))).status).toBe(200);

    clock = paris(addDays(d, 10), 10);
    await collect();
    expect((await step(id, 8)).status).toBe('pending');
    clock = paris(addDays(d, 11), 10);
    await collect();
    expect((await step(id, 8)).status).toBe('drafted');
    expect((await timeline(id)).some((e) => e.event === 'promise')).toBe(true);
  });
});

describe('Encaissée', () => {
  it('records the payment, ends the plan and reports it to the platform once', async () => {
    const t = await newTenant(request);
    const d = due();
    const id = await delivered(t, d, 'paye@client.test');
    clock = paris(addDays(d, 3), 10);
    await collect();
    const pay = (paidOn?: string) =>
      request(`/invoices/${id}/payment`, {
        method: 'POST',
        token: t.apiKey,
        body: paidOn ? { paidOn } : {},
      });
    expect((await pay(addDays(d, 4))).status).toBe(400);
    const res = await pay();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'paid' });
    expect((await pay()).status).toBe(200);
    expect(api.jobs.payments.filter((p) => p === id)).toHaveLength(1);
    expect((await plan(id)).steps.map((s) => [s.status, s.reason])).toEqual([
      ['skipped', 'superseded'],
      ['cancelled', 'ended'],
      ['cancelled', 'ended'],
      ['cancelled', 'ended'],
      ['cancelled', 'ended'],
    ]);
    clock = paris(addDays(d, 30), 10);
    await collect();
    expect((await plan(id)).nextStepOn).toBeNull();

    // The platform is down, then answers.
    const calls: unknown[] = [];
    let down = true;
    const adapter = fakeAdapter({
      reportPayment: async (input) => {
        calls.push(input);
        if (down) throw new PdpUnavailableError('503');
      },
    });
    await expect(runReportPayment(worker(adapter), id)).rejects.toThrow(PdpUnavailableError);
    down = false;
    await runReportPayment(worker(adapter), id);
    await runReportPayment(worker(adapter), id);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ account: t.account, amount: (await invoice(id)).payable });
    const [report] = await database.db
      .select()
      .from(paymentReports)
      .where(eq(paymentReports.invoiceId, id));
    expect(report).toMatchObject({ status: 'reported', attempts: 2, lastError: null });
  });

  it('marks a payment report the platform refuses as failed, without retrying', async () => {
    const t = await newTenant(request);
    const id = await delivered(t, due(), null);
    expect(
      (await request(`/invoices/${id}/payment`, { method: 'POST', token: t.apiKey, body: {} }))
        .status,
    ).toBe(200);
    const adapter = fakeAdapter({
      reportPayment: async () => {
        throw new Error('422 already paid');
      },
    });
    await runReportPayment(worker(adapter), id);
    const [report] = await database.db
      .select()
      .from(paymentReports)
      .where(eq(paymentReports.invoiceId, id));
    expect(report).toMatchObject({ status: 'failed', lastError: '422 already paid' });
  });

  it('refuses a payment on an invoice that has not left', async () => {
    const t = await newTenant(request);
    clock = new Date();
    const res = await request('/invoices', {
      method: 'POST',
      token: t.apiKey,
      body: { draft: draft(1) },
    });
    const { id } = (await res.json()) as { id: string };
    const refused = await request(`/invoices/${id}/payment`, {
      method: 'POST',
      token: t.apiKey,
      body: {},
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('not_payable');
  });
});
