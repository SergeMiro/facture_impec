// Autopilot send (plan §0.2): who may go by itself, the wait after the last change, « Annuler l'envoi
// automatique », and every check run again when the invoice is due.
import { type InvoiceDraft, parisTime } from '@fi/core';
import type { Database } from '@fi/db';
import { auditEvents, eq, invoiceEvents, invoices, sql } from '@fi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTOPILOT_GRACE_MS, autopilotNote, runAutopilot } from './autopilot';
import {
  deliveredInvoice,
  draft,
  fakeAdapter,
  newTenant,
  type RecordedJobs,
  testApi,
  testDatabase,
} from './test-helpers';

/** The buyer of golden invoice 01. */
const CUSTOMER = '200000008';
const CEILING = 500_000;

let known = true;
const adapter = fakeAdapter({ lookupRecipient: async ({ siren }) => (known ? { siren } : null) });

let database: Database;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];
let jobs: RecordedJobs;
let clock = new Date();

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: adapter }, undefined, { now: () => clock });
  ({ request, jobs } = api);
});
afterAll(async () => {
  await database.close();
});
// The sweep takes every company's due invoices: each test starts with none planned by the others.
beforeEach(async () => {
  await database.db.update(invoices).set({ autopilotAt: null, autopilotFingerprint: null });
});

interface Detail {
  id: string;
  status: string;
  issues: unknown[];
  partyId: string | null;
  autopilot: { at: string | null; held: boolean };
  events: { type: string; event: string | null; actor: string; payload: Record<string, unknown> }[];
}

const minutes = (n: number) => {
  clock = new Date(clock.getTime() + n * 60_000);
};

async function company(mode: 'autopilot' | 'review' = 'autopilot') {
  const t = await newTenant(request);
  const settings = await request('/settings', {
    method: 'PATCH',
    token: t.apiKey,
    body: { mode, autopilotMaxAmount: CEILING },
  });
  expect(settings.status).toBe(200);
  const party = await request('/parties', {
    method: 'POST',
    token: t.apiKey,
    body: { siren: CUSTOMER },
  });
  const { id: partyId } = (await party.json()) as { id: string };
  await request(`/parties/${partyId}`, {
    method: 'PATCH',
    token: t.apiKey,
    body: { autopilot: true },
  });
  return { ...t, partyId };
}

async function create(apiKey: string, invoice: InvoiceDraft) {
  const res = await request('/invoices', {
    method: 'POST',
    token: apiKey,
    body: { draft: invoice },
  });
  return (await res.json()) as Detail;
}

async function detail(apiKey: string, id: string) {
  return (await (await request(`/invoices/${id}`, { token: apiKey })).json()) as Detail;
}

/** A company with its trial done: invoice 1 sent by hand and delivered. */
async function trained() {
  const t = await company();
  await deliveredInvoice(api, t, draft(1));
  return t;
}

describe('who goes by itself', () => {
  it('waits for a first invoice sent by hand and delivered, then plans the next ones', async () => {
    const t = await company();
    const first = await create(t.apiKey, draft(1));
    expect(first).toMatchObject({ status: 'validated', issues: [], partyId: t.partyId });
    expect(first.autopilot).toEqual({ at: null, held: false });
    await deliveredInvoice(api, t, draft(2));
    // The first one is planned now that a delivered invoice exists: a change plans it again.
    const second = await create(t.apiKey, draft(3));
    expect(second.autopilot.at).toBe(new Date(clock.getTime() + AUTOPILOT_GRACE_MS).toISOString());
  });

  it('leaves alone what the autopilot may not take', async () => {
    const t = await trained();
    const over = await create(
      t.apiKey,
      draft(2, (d) => {
        for (const l of d.lines ?? []) l.quantity = '1000';
      }),
    );
    expect(over.autopilot.at).toBeNull();
    const credit = await create(
      t.apiKey,
      draft(3, (d) => {
        d.typeCode = '381';
        d.precedingInvoices = [{ number: 'F-1', issueDate: d.issueDate ?? '' }];
      }),
    );
    expect(credit.autopilot.at).toBeNull();
    const stranger = await create(
      t.apiKey,
      draft(4, (d) => {
        d.buyer = { ...d.buyer, legalId: { id: '999000128', scheme: '0002' } };
        d.buyer.electronicAddress = { id: '999000128', scheme: '0225' };
      }),
    );
    expect(stranger).toMatchObject({ partyId: null, autopilot: { at: null } });
    // Review mode: nothing is planned at all.
    const review = await company('review');
    await deliveredInvoice(api, review, draft(1));
    expect((await create(review.apiKey, draft(2))).autopilot.at).toBeNull();
  });
});

describe('the wait', () => {
  it('sends a due invoice by itself, with the system as the one who approved it', async () => {
    const t = await trained();
    const { id } = await create(t.apiKey, draft(2));
    minutes(14);
    expect(await runAutopilot(api.deps)).toEqual({ sent: 0, cancelled: 0 });
    minutes(2);
    jobs.sends.length = 0;
    expect(await runAutopilot(api.deps)).toEqual({ sent: 1, cancelled: 0 });
    expect(jobs.sends).toEqual([id]);
    const after = await detail(t.apiKey, id);
    expect(after.status).toBe('ready_to_send');
    expect(after.autopilot.at).toBeNull();
    expect(after.events.at(-1)).toMatchObject({
      event: 'approve',
      actor: 'system',
      payload: { autopilot: true },
    });
    const actions = (
      await database.db.select().from(auditEvents).where(eq(auditEvents.objectId, id))
    ).map((e) => e.action);
    expect(actions).toContain('invoice.autopilot');
    // Due again on the next sweep: nothing more happens.
    expect(await runAutopilot(api.deps)).toEqual({ sent: 0, cancelled: 0 });
  });

  it('says in FI_Détail when the invoice leaves', async () => {
    const t = await trained();
    const { id } = await create(t.apiKey, draft(2));
    const [row] = await database.db.select().from(invoices).where(eq(invoices.id, id));
    if (!row?.autopilotAt) throw new Error('not planned');
    expect(autopilotNote(row)).toBe(
      `Envoi automatique prévu à ${parisTime(row.autopilotAt)}. Pour le retenir : « Annuler l'envoi automatique » dans la fiche facture.`,
    );
  });

  it('starts again on every change, and an unchanged sync keeps the planned time', async () => {
    const t = await trained();
    const created = await create(t.apiKey, draft(2));
    const planned = created.autopilot.at;
    minutes(10);
    const same = await request(`/invoices/${created.id}`, {
      method: 'PUT',
      token: t.apiKey,
      body: { draft: draft(2) },
    });
    expect(((await same.json()) as Detail).autopilot.at).toBe(planned);
    const changed = await request(`/invoices/${created.id}`, {
      method: 'PUT',
      token: t.apiKey,
      body: {
        draft: draft(2, (d) => {
          d.notes = [...(d.notes ?? []), { text: 'Merci !' }];
        }),
      },
    });
    const moved = ((await changed.json()) as Detail).autopilot.at;
    expect(moved).toBe(new Date(clock.getTime() + AUTOPILOT_GRACE_MS).toISOString());
    minutes(6);
    expect((await runAutopilot(api.deps)).sent).toBe(0);
  });

  it("holds an invoice for good on « Annuler l'envoi automatique »", async () => {
    const t = await trained();
    const { id } = await create(t.apiKey, draft(2));
    const held = await request(`/invoices/${id}/autopilot/cancel`, {
      method: 'POST',
      token: t.apiKey,
    });
    expect(((await held.json()) as Detail).autopilot).toEqual({ at: null, held: true });
    const edited = await request(`/invoices/${id}`, {
      method: 'PUT',
      token: t.apiKey,
      body: {
        draft: draft(2, (d) => {
          d.notes = [...(d.notes ?? []), { text: 'Modifiée' }];
        }),
      },
    });
    expect(((await edited.json()) as Detail).autopilot).toEqual({ at: null, held: true });
    minutes(20);
    expect((await runAutopilot(api.deps)).sent).toBe(0);
    // « Envoyer » still works.
    const sent = await request(`/invoices/${id}/send`, { method: 'POST', token: t.apiKey });
    expect(sent.status).toBe(202);
    const [note] = await database.db
      .select()
      .from(invoiceEvents)
      .where(eq(invoiceEvents.event, 'autopilot_held'));
    expect(note?.actor).toBe('user');
  });
});

describe('checked again when due', () => {
  it('cancels with the reason on the timeline when the platform no longer knows the customer', async () => {
    const t = await trained();
    const { id } = await create(t.apiKey, draft(2));
    minutes(16);
    known = false;
    try {
      expect(await runAutopilot(api.deps)).toEqual({ sent: 0, cancelled: 1 });
    } finally {
      known = true;
    }
    const after = await detail(t.apiKey, id);
    expect(after).toMatchObject({ status: 'validated', autopilot: { at: null, held: false } });
    expect(after.events.at(-1)).toMatchObject({
      type: 'note',
      event: 'autopilot_cancelled',
      payload: { reason: { code: 'notFound', message: expect.stringContaining('annuaire') } },
    });
  });

  it('forgets the plan when the company goes back to Review or the customer is opted out', async () => {
    const t = await trained();
    const a = await create(t.apiKey, draft(2));
    expect(a.autopilot.at).not.toBeNull();
    await request('/settings', { method: 'PATCH', token: t.apiKey, body: { mode: 'review' } });
    expect((await detail(t.apiKey, a.id)).autopilot.at).toBeNull();
    await request('/settings', { method: 'PATCH', token: t.apiKey, body: { mode: 'autopilot' } });
    expect((await detail(t.apiKey, a.id)).autopilot.at).not.toBeNull();
    await request(`/parties/${t.partyId}`, {
      method: 'PATCH',
      token: t.apiKey,
      body: { autopilot: false },
    });
    expect((await detail(t.apiKey, a.id)).autopilot.at).toBeNull();
  });

  it('cancels a due invoice the ceiling no longer covers, even when nothing planned it again', async () => {
    const t = await trained();
    const { id } = await create(t.apiKey, draft(2));
    await request('/settings', {
      method: 'PATCH',
      token: t.apiKey,
      body: { autopilotMaxAmount: 1 },
    });
    // As if the ceiling moved without planning again (another instance, a manual fix).
    await database.db
      .update(invoices)
      .set({
        autopilotAt: new Date(clock.getTime() - 1),
        autopilotFingerprint: sql`${invoices.fingerprint}`,
      })
      .where(eq(invoices.id, id));
    expect(await runAutopilot(api.deps)).toEqual({ sent: 0, cancelled: 1 });
    const after = await detail(t.apiKey, id);
    expect(after.events.at(-1)?.payload).toMatchObject({ reason: { code: 'amount' } });
  });
});
