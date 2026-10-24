// Corrections from the pane (R8), end to end: « Corriger pour moi » on the 300/400 example (the card,
// the finding closed once the cell is written, the undo), a cell the person changed (nothing written,
// a second click to put a value back), an invoice already sent (a credit note instead), and the lock
// while a card waits: its invoice's findings held, its send and its autopilot waiting, the other
// invoices checked as usual.
import type { Database } from '@fi/db';
import { edits, eq, invoices } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTOPILOT_GRACE_MS, runAutopilot } from './autopilot';
import { checkNow, runChecks } from './checks';
import { companies, type Detail, invoiceRow, invoiceSheet, orders, SEP1 } from './checks.fixtures';
import { EDIT_LOCK_MS } from './edits';
import {
  deliveredInvoice,
  draft,
  fakeAdapter,
  type RecordedJobs,
  testApi,
  testDatabase,
  today,
} from './test-helpers';

const adapter = fakeAdapter({ lookupRecipient: async ({ siren }) => ({ siren }) });

let database: Database;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];
let jobs: RecordedJobs;
let clock = new Date(`${today()}T08:00:00Z`);

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: adapter }, undefined, { now: () => clock });
  ({ request, jobs } = api);
});
afterAll(async () => {
  await database.close();
});

const company = (workbook: string) => companies({ request, database })(workbook);

interface Edit {
  id: string;
  status: string;
  sheet: string;
  cell: string;
  before: string;
  after: string;
  found: string | null;
  reason: string | null;
  undoable: boolean;
}
interface Decided {
  edit: Edit;
  resolved: boolean | null;
  remaining: { id: string; message: string }[];
}
interface FixedFinding {
  id: string;
  amount: number | null;
  invoiceId: string | null;
  fix: Record<string, unknown> | null;
}

const chairs = (number: string, price: number) =>
  invoiceRow(number, 'C-118', 'Chaise pliante', 10, price);

/** The 300/400 example, checked: the order says 40 €, the invoice bills 30 €. */
async function example(workbook: string) {
  const c = await company(workbook);
  await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
  await c.syncInvoices(invoiceSheet(chairs('F-2026-042', 30)));
  await checkNow(database.db, c.id, clock);
  const [finding] = (await c.checks()).findings as unknown as FixedFinding[];
  if (!finding) throw new Error('no finding');
  /** The pane wrote the cell and read the sheet again. */
  const write = (price: number) => c.syncInvoices(invoiceSheet(chairs('F-2026-042', price)));
  const decide = (id: string, decision: Record<string, unknown>, status = 200) =>
    c.call(`/edits/${id}`, 'POST', decision, status) as Promise<Decided>;
  return { ...c, finding, write, decide };
}

describe('« Corriger pour moi » on the 300/400 example', () => {
  it('offers 30 → 40 in its cell, says « corrigé » once the checks agree, and takes it back', async () => {
    const c = await example('wb-edits-01');
    expect(c.finding.fix).toEqual({
      sheet: 'Factures',
      cell: 'K2',
      workbookId: 'wb-edits-01',
      field: 'price',
      before: '30',
      after: '40',
    });
    const edit = (await c.call(`/findings/${c.finding.id}/fix`, 'POST', {})) as Edit;
    expect(edit).toMatchObject({
      status: 'proposed',
      sheet: 'Factures',
      cell: 'K2',
      before: '30',
      after: '40',
      undoable: false,
    });
    // The pane asks again right before writing: the same card.
    expect(((await c.call(`/findings/${c.finding.id}/fix`, 'POST')) as Edit).id).toBe(edit.id);

    await c.write(40);
    const applied = await c.decide(edit.id, { status: 'applied' });
    expect(applied).toMatchObject({
      resolved: true,
      remaining: [],
      edit: { status: 'applied', undoable: true },
    });
    expect((await c.checks()).findings).toEqual([]);
    // The card was answered: a second click changes nothing.
    await c.decide(edit.id, { status: 'applied' }, 409);

    // « Annuler la correction » (undoEdit without its id finds it), then 30 back in the cell.
    expect(((await c.call(`/findings/${c.finding.id}/edits/last`)) as Edit).id).toBe(edit.id);
    expect(((await c.call(`/edits/${edit.id}/undo`, 'POST')) as Edit).id).toBe(edit.id);
    await c.write(30);
    const reverted = await c.decide(edit.id, { status: 'reverted' });
    expect(reverted).toMatchObject({
      resolved: false,
      edit: { status: 'reverted', undoable: false },
    });
    expect(reverted.remaining.map((f) => f.id)).toEqual([c.finding.id]);
    await c.call(`/findings/${c.finding.id}/edits/last`, 'GET', undefined, 404);

    for (const action of ['edit.propose', 'edit.apply', 'edit.undo_propose', 'edit.revert']) {
      const [event] = await c.audits(action);
      expect(event, action).toMatchObject({ objectType: 'invoice', objectId: c.finding.invoiceId });
    }
    expect((await c.audits('edit.propose'))[0]?.actor).toBe('user');
  });

  it('writes nothing over a cell the person changed, and asks before putting a value back', async () => {
    const c = await example('wb-edits-02');
    const first = (await c.call(`/findings/${c.finding.id}/fix`, 'POST', { by: 'agent' })) as Edit;
    // The cell held 35: the pane wrote nothing and says so.
    const conflict = await c.decide(first.id, { status: 'conflict', found: '35' });
    expect(conflict).toMatchObject({
      resolved: false,
      edit: { status: 'conflict', found: '35', reason: 'changed', undoable: false },
    });
    expect((await c.audits('edit.propose'))[0]?.actor).toBe('agent:chat');

    // Asked again, a new card; applied this time.
    const second = (await c.call(`/findings/${c.finding.id}/fix`, 'POST', {})) as Edit;
    expect(second.id).not.toBe(first.id);
    await c.write(40);
    expect((await c.decide(second.id, { status: 'applied' })).resolved).toBe(true);

    // The undo card declined: the correction stays.
    await c.call(`/edits/${second.id}/undo`, 'POST');
    expect((await c.decide(second.id, { status: 'kept' })).edit).toMatchObject({
      status: 'applied',
      undoable: true,
    });

    // The person typed 45 since: the undo finds 45, not 40, and writes nothing…
    await c.call(`/edits/${second.id}/undo`, 'POST');
    const held = await c.decide(second.id, { status: 'conflict', found: '45', reason: 'changed' });
    expect(held.edit).toMatchObject({ status: 'conflict', found: '45', undoable: true });
    // …until « Remettre quand même », the second click.
    await c.call(`/edits/${second.id}/undo`, 'POST');
    await c.write(30);
    expect((await c.decide(second.id, { status: 'reverted' })).edit.status).toBe('reverted');
  });

  it('refuses on an invoice already sent: « Établir un avoir » on its fiche instead', async () => {
    const c = await example('wb-edits-03');
    const id = c.finding.invoiceId ?? '';
    const [held] = (await c.detail(id)).findings;
    const sent = await request(`/invoices/${id}/send`, {
      method: 'POST',
      token: c.apiKey,
      body: { acknowledge: [held?.fingerprint] },
    });
    expect(sent.status).toBe(202);
    const refused = await request(`/findings/${c.finding.id}/fix`, {
      method: 'POST',
      token: c.apiKey,
    });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invoice_sent');
    expect(body.error.message).toBe(
      "La facture F-2026-042 du 10/09/2026 est déjà envoyée : elle ne se modifie plus et reste telle quelle. Pour corriger les 100,00 € en cause, ouvrez sa fiche et cliquez sur « Établir un avoir » : l'avoir l'annule en entier. Envoyez ensuite une nouvelle facture corrigée, avec un nouveau numéro.",
    );
    expect(await c.audits('edit.propose')).toEqual([]);
  });

  it('says so when no single cell corrects the finding, or when it is not there', async () => {
    const c = await company('wb-edits-04');
    // Ordered 10, billed 12: no price to change.
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-044', 'C-118', 'Chaise pliante', 12, 40)));
    await checkNow(database.db, c.id, clock);
    const [found] = (await c.checks()).findings as unknown as FixedFinding[];
    expect(found?.fix).toBeNull();
    await c.call(`/findings/${found?.id}/fix`, 'POST', {}, 422);
    const other = await company('wb-edits-05');
    await other.call(`/findings/${found?.id}/fix`, 'POST', {}, 404);
  });
});

describe('RGPD', () => {
  it('exports the corrections with the account, and erases them with it', async () => {
    const c = await example('wb-edits-09');
    const card = (await c.call(`/findings/${c.finding.id}/fix`, 'POST', {})) as Edit;
    await c.write(40);
    await c.decide(card.id, { status: 'applied' });
    const data = (await c.call('/tenant/export')) as {
      registry: { edits: Record<string, unknown>[] };
    };
    expect(data.registry.edits).toEqual([
      expect.objectContaining({
        finding: c.finding.id,
        by: 'person',
        sheet: 'Factures',
        cell: 'K2',
        before: '30',
        after: '40',
        status: 'applied',
      }),
    ]);
    await c.call('/tenant', 'DELETE', { confirmSiren: '100000009' });
    expect(await database.db.select().from(edits).where(eq(edits.tenantId, c.id))).toEqual([]);
  });
});

describe('the lock while a card waits', () => {
  it('holds its invoice’s findings and its send, and checks the other invoices as usual', async () => {
    const c = await company('wb-edits-06');
    await c.includeOrders(
      orders(
        ['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40],
        ['C-119', SEP1, 'Durand SARL', 'Tabouret', 5, 20],
      ),
    );
    const sheet = (chair: number, stool: number) =>
      invoiceSheet(
        invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, chair),
        invoiceRow('F-2026-043', 'C-119', 'Tabouret', 5, stool),
      );
    await c.syncInvoices(sheet(30, 20));
    await checkNow(database.db, c.id, clock);
    const [finding] = (await c.checks()).findings as unknown as FixedFinding[];
    const card = (await c.call(`/findings/${finding?.id}/fix`, 'POST', {})) as Edit;
    const invoiceId = finding?.invoiceId ?? '';
    const [locked] = await database.db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(locked?.editLockUntil?.getTime()).toBe(clock.getTime() + EDIT_LOCK_MS);

    // Both lines change under the card: only the other invoice's finding moves.
    await c.syncInvoices(sheet(35, 15));
    await runChecks(database.db, c.id, clock);
    const during = (await c.checks()).findings as unknown as FixedFinding[];
    expect(during.map((f) => [f.invoiceId === invoiceId, f.amount])).toEqual([
      [true, 10_000],
      [false, 2_500],
    ]);

    // « Envoyer » waits for the card.
    const refused = await request(`/invoices/${invoiceId}/send`, {
      method: 'POST',
      token: c.apiKey,
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'invoice_editing',
    );

    // « Ne pas appliquer »: the lock goes and the invoice is read as it is now.
    const declined = (await c.call(`/edits/${card.id}`, 'POST', {
      status: 'declined',
    })) as Decided;
    expect(declined).toMatchObject({ resolved: false, edit: { status: 'declined' } });
    expect(declined.remaining.map((f) => f.id)).toEqual([finding?.id]);
    const now = (await c.checks()).findings as unknown as FixedFinding[];
    expect(now.find((f) => f.invoiceId === invoiceId)).toMatchObject({
      amount: 5_000,
      fix: expect.objectContaining({ before: '35', after: '40' }),
    });
    const [free] = await database.db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(free?.editLockUntil).toBeNull();
  });

  it('runs out after five minutes: a card left open is never written as it was', async () => {
    const c = await example('wb-edits-07');
    const card = (await c.call(`/findings/${c.finding.id}/fix`, 'POST', {})) as Edit;
    await c.write(35);
    clock = new Date(clock.getTime() + EDIT_LOCK_MS + 1_000);
    await runChecks(database.db, c.id, clock);
    expect(((await c.checks()).findings[0] as unknown as FixedFinding).amount).toBe(5_000);
    // The pane asks again before writing: the old card is withdrawn, a new one says 35 → 40.
    const fresh = (await c.call(`/findings/${c.finding.id}/fix`, 'POST', {})) as Edit;
    expect(fresh).toMatchObject({ before: '35', after: '40', status: 'proposed' });
    expect(fresh.id).not.toBe(card.id);
    expect(((await c.call(`/edits/${card.id}`)) as Edit).status).toBe('declined');
  });

  it('keeps the autopilot from sending the invoice until the card is answered', async () => {
    const c = await company('wb-edits-08');
    await c.call('/settings', 'PATCH', { mode: 'autopilot', autopilotMaxAmount: 500_000 });
    const party = (await c.call('/parties', 'POST', { siren: '200000008' }, 201)) as { id: string };
    await c.call(`/parties/${party.id}`, 'PATCH', { autopilot: true });
    await deliveredInvoice(api, c, draft(1));
    const created = (await c.call('/invoices', 'POST', { draft: draft(2) }, 201)) as Detail;
    expect(created.autopilot.at).not.toBeNull();
    await database.db
      .update(invoices)
      .set({ editLockUntil: new Date(clock.getTime() + AUTOPILOT_GRACE_MS + EDIT_LOCK_MS) })
      .where(eq(invoices.id, created.id));

    clock = new Date(clock.getTime() + AUTOPILOT_GRACE_MS + 60_000);
    expect((await runAutopilot(api.deps)).sent).toBe(0);
    expect(jobs.sends).not.toContain(created.id);
    expect((await c.detail(created.id)).autopilot.at).not.toBeNull();

    clock = new Date(clock.getTime() + EDIT_LOCK_MS);
    expect((await runAutopilot(api.deps)).sent).toBe(1);
    expect(jobs.sends).toContain(created.id);
  });
});
