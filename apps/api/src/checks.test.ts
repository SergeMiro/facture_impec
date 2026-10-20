// Checks across documents (R2), end to end: an order sheet and the invoice sheet in the registry, the
// 300/400 example found with its money and its cells, the send gate (« Envoyer quand même », audited),
// the autopilot that never sends past a blocking finding, « Oui » / « Non » on a proposed link, the
// sweep that checks again, and the RGPD export and erasure.
import { detectMapping, type GridCell, grid, type InvoiceDraft } from '@fi/core';
import type { Database } from '@fi/db';
import { and, auditEvents, checkState, eq, findings, invoices, links } from '@fi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTOPILOT_GRACE_MS, runAutopilot } from './autopilot';
import { checkNow, checksBehind, runChecks } from './checks';
import {
  deliveredInvoice,
  draft,
  fakeAdapter,
  newTenant,
  type RecordedJobs,
  testApi,
  testDatabase,
} from './test-helpers';
import type { SyncResult } from './workbooks';

const adapter = fakeAdapter({ lookupRecipient: async ({ siren }) => ({ siren }) });

let database: Database;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];
let jobs: RecordedJobs;
let clock = new Date('2026-10-20T08:00:00Z');

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: adapter }, undefined, { now: () => clock });
  ({ request, jobs } = api);
});
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  await database.db.update(invoices).set({ autopilotAt: null, autopilotFingerprint: null });
});

const d = (serial: number, text: string): GridCell => ({ v: serial, t: text, f: 'dd/mm/yyyy' });
const SEP1 = d(46266, '01/09/2026');
const SEP10 = d(46275, '10/09/2026');

const ORDER_HEADER: GridCell[] = ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'];
const orders = (...rows: GridCell[][]) => grid('Commandes', [ORDER_HEADER, ...rows]);

const INVOICE_HEADER: GridCell[] = [
  'N° Facture',
  'Date',
  'Client',
  'SIREN',
  'Adresse',
  'Code postal',
  'Ville',
  'N° commande',
  'Désignation',
  'Qté',
  'P.U. HT',
  'TVA',
];
const invoiceRow = (
  number: string,
  order: string | null,
  item: string,
  quantity: number,
  price: number,
): GridCell[] => [
  number,
  SEP10,
  'Durand SARL',
  '200000008',
  '3 rue de la Gare',
  '21000',
  'Dijon',
  order,
  item,
  quantity,
  price,
  { v: 0.2, t: '20%', f: '0%' },
];
const invoiceSheet = (...rows: GridCell[][]) => grid('Factures', [INVOICE_HEADER, ...rows]);

interface Finding {
  id: string;
  rule: string;
  severity: string;
  message: string;
  amount: number | null;
  invoiceId: string | null;
  fingerprint: string;
  evidence: {
    role: string;
    number: string | null;
    sheet: string | null;
    workbookId: string | null;
    cell: string | null;
  }[];
}
interface Checks {
  checkedAt: string | null;
  atStake: number;
  blocking: number;
  findings: Finding[];
  links: {
    id: string;
    kind: string;
    score: number;
    from: { number: string | null } | null;
    to: { number: string | null } | null;
  }[];
}
interface Detail {
  id: string;
  status: string;
  autopilot: { at: string | null; held: boolean };
  findings: Finding[];
  events: { type: string; event: string | null; payload: Record<string, unknown> }[];
}

async function company(workbook: string, extra: Record<string, unknown> = {}) {
  const t = await newTenant(request, {
    vatId: 'FR88100000009',
    address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
    ...extra,
  });
  await request('/settings', {
    method: 'PATCH',
    token: t.apiKey,
    body: {
      invoiceDefaults: {
        siret: '10000000900017',
        iban: 'FR7630006000011234567890189',
        paymentDays: 30,
        operationCategory: 'goods',
      },
    },
  });
  const call = async (path: string, method = 'GET', body?: unknown, status = 200) => {
    const res = await request(path, {
      method,
      token: t.apiKey,
      ...(body !== undefined && { body }),
    });
    expect(res.status, await res.clone().text()).toBe(status);
    return res.json();
  };
  const includeOrders = async (snapshot: ReturnType<typeof grid>) => {
    const base = `/workbooks/${workbook}/sources`;
    const { layout } = (await call(`${base}/detect`, 'POST', { snapshot })) as { layout: unknown };
    return call(`${base}/${encodeURIComponent(snapshot.sheet)}`, 'PUT', { layout, snapshot });
  };
  const syncOrders = (snapshot: ReturnType<typeof grid>) =>
    call(`/workbooks/${workbook}/sources/${encodeURIComponent(snapshot.sheet)}/sync`, 'POST', {
      snapshot,
    });
  const syncInvoices = async (snapshot: ReturnType<typeof grid>) =>
    (await call(`/workbooks/${workbook}/sync`, 'POST', {
      snapshot,
      mapping: detectMapping(snapshot),
    })) as SyncResult;
  const checks = () => call('/checks') as Promise<Checks>;
  const detail = (id: string) => call(`/invoices/${id}`) as Promise<Detail>;
  const audits = async (action: string) =>
    database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, t.id), eq(auditEvents.action, action)));
  const invoiceId = async (number: string) => {
    const [row] = await database.db
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.tenantId, t.id), eq(invoices.number, number)));
    if (!row) throw new Error(`no invoice ${number}`);
    return row.id;
  };
  return {
    ...t,
    call,
    includeOrders,
    syncOrders,
    syncInvoices,
    checks,
    detail,
    audits,
    invoiceId,
  };
}

describe('the 300/400 example', () => {
  it('finds 100 € missing against order C-118, with the cells of both documents', async () => {
    const c = await company('wb-checks-01');
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30)));
    // A read that changed the registry queues the job that checks again.
    expect(jobs.registry.filter((id) => id === c.id).length).toBeGreaterThanOrEqual(2);

    const run = await checkNow(database.db, c.id, clock);
    expect(run).toMatchObject({ open: 1, changed: 1 });
    const view = await c.checks();
    expect(view).toMatchObject({ atStake: 10_000, blocking: 1, links: [] });
    const [b1] = view.findings;
    expect(b1).toMatchObject({ rule: 'B1', severity: 'blocking', amount: 10_000 });
    expect(b1?.message).toBe(
      'La facture F-2026-042 facture 10 « Chaise pliante » pour 300,00 €, alors que la commande C-118 prévoyait 400,00 € : il manque 100,00 €.',
    );
    // « Corriger la ligne » selects the invoice's price, « Voir la commande » the order's line.
    expect(b1?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'invoice',
          number: 'F-2026-042',
          sheet: 'Factures',
          workbookId: 'wb-checks-01',
          cell: 'Factures!K2',
        }),
        expect.objectContaining({
          role: 'order',
          number: 'C-118',
          sheet: 'Commandes',
          workbookId: 'wb-checks-01',
          cell: 'Commandes!D2',
        }),
      ]),
    );
    const [link] = await database.db.select().from(links).where(eq(links.tenantId, c.id));
    expect(link).toMatchObject({ kind: 'billed_by', method: 'number', status: 'auto', score: 100 });
    const id = await c.invoiceId('F-2026-042');
    expect((await c.detail(id)).findings.map((f) => f.rule)).toEqual(['B1']);
    expect(await c.audits('checks.run')).toHaveLength(1);
    // Nothing moved: the next job does not check again.
    expect(await checkNow(database.db, c.id, clock)).toBeNull();

    // Corrected in the sheet: the finding is resolved, and stays as history.
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 40)));
    expect(await checkNow(database.db, c.id, clock)).toMatchObject({ open: 0, changed: 1 });
    expect((await c.checks()).findings).toEqual([]);
    const [kept] = await database.db.select().from(findings).where(eq(findings.tenantId, c.id));
    expect(kept).toMatchObject({ status: 'resolved', amount: 10_000 });
    expect(await c.audits('checks.run')).toHaveLength(2);

    // Wrong again: the same finding opens again, under the same key.
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    const again = await database.db.select().from(findings).where(eq(findings.tenantId, c.id));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ status: 'open', resolvedAt: null, key: kept?.key });
  });
});

describe('the send gate', () => {
  it('turns « Envoyer » into « Envoyer quand même », and keeps the user’s word in the audit', async () => {
    const c = await company('wb-checks-02');
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30)));
    const id = await c.invoiceId('F-2026-042');
    expect((await c.detail(id)).status).toBe('validated');

    // « Envoyer » checks first, even before the registry job ran.
    const refused = await request(`/invoices/${id}/send`, { method: 'POST', token: c.apiKey });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('blocking_findings');
    expect(body.error.message).toContain('Envoyer quand même');
    expect((await c.detail(id)).status).toBe('validated');
    expect(jobs.sends).not.toContain(id);

    const [finding] = (await c.detail(id)).findings;
    // A finding the user did not see (another fingerprint) asks again.
    const stale = await request(`/invoices/${id}/send`, {
      method: 'POST',
      token: c.apiKey,
      body: { acknowledge: ['an-older-one'] },
    });
    expect(stale.status).toBe(409);

    const sent = await request(`/invoices/${id}/send`, {
      method: 'POST',
      token: c.apiKey,
      body: { acknowledge: [finding?.fingerprint] },
    });
    expect(sent.status).toBe(202);
    expect(jobs.sends).toContain(id);
    const after = await c.detail(id);
    expect(after.status).toBe('ready_to_send');
    expect(after.events.find((e) => e.event === 'sent_despite_findings')?.payload).toEqual({
      findings: [{ key: expect.stringMatching(/^B1:/), amount: 10_000 }],
    });
    const [audit] = await c.audits('invoice.send_despite_findings');
    expect(audit).toMatchObject({ actor: 'user', objectType: 'invoice', objectId: id });
    expect(audit?.afterHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends with a plain « Envoyer » when nothing blocks', async () => {
    const c = await company('wb-checks-03');
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-043', 'C-118', 'Chaise pliante', 10, 40)));
    const id = await c.invoiceId('F-2026-043');
    const sent = await request(`/invoices/${id}/send`, { method: 'POST', token: c.apiKey });
    expect(sent.status).toBe(202);
    expect(await c.audits('invoice.send_despite_findings')).toHaveLength(0);
  });
});

describe('the autopilot', () => {
  const CUSTOMER = '200000008';
  const withOrder = (index: number) =>
    draft(index, (x: InvoiceDraft) => {
      x.purchaseOrderReference = 'C-9';
    });
  const orderC9 = (price: number) =>
    orders(['C-9', SEP1, 'Boulangerie Martin SAS', 'Journée de conseil en organisation', 3, price]);

  async function trained(workbook: string) {
    const c = await company(workbook);
    await c.call('/settings', 'PATCH', { mode: 'autopilot', autopilotMaxAmount: 500_000 });
    const party = (await c.call('/parties', 'POST', { siren: CUSTOMER }, 201)) as { id: string };
    await c.call(`/parties/${party.id}`, 'PATCH', { autopilot: true });
    await deliveredInvoice(api, c, draft(1));
    return c;
  }

  it('never sends past a blocking finding: it cancels and says why on the timeline', async () => {
    const c = await trained('wb-checks-04');
    // The order says 3 days at 500 €; the invoice bills them at 450 €.
    await c.includeOrders(orderC9(500));
    const created = (await c.call('/invoices', 'POST', { draft: withOrder(2) }, 201)) as Detail;
    // Planned on its own change: the check has not run yet.
    expect(created.autopilot.at).toBe(new Date(clock.getTime() + AUTOPILOT_GRACE_MS).toISOString());

    clock = new Date(clock.getTime() + AUTOPILOT_GRACE_MS + 60_000);
    const sweep = await runAutopilot(api.deps);
    expect(sweep.sent).toBe(0);
    expect(jobs.sends).not.toContain(created.id);
    const after = await c.detail(created.id);
    expect(after.status).toBe('validated');
    expect(after.autopilot.at).toBeNull();
    expect(after.findings.map((f) => f.rule)).toEqual(['B1']);
    const note = after.events.find((e) => e.event === 'autopilot_cancelled');
    expect(note?.payload).toEqual({
      reason: {
        code: 'findings',
        message: "un contrôle a trouvé un écart à vérifier avant l'envoi (voir Contrôles)",
      },
    });
    expect(await c.audits('invoice.autopilot_cancel')).toHaveLength(1);

    // A change of the invoice does not plan it while the finding is open.
    const edited = (await c.call(`/invoices/${created.id}`, 'PUT', {
      draft: withOrder(2),
    })) as Detail;
    expect(edited.autopilot.at).toBeNull();

    // The order corrected to 450 €: nothing holds the invoice any more, it is planned again.
    await c.syncOrders(orderC9(450));
    await checkNow(database.db, c.id, clock);
    expect((await c.detail(created.id)).autopilot.at).not.toBeNull();
  });

  it('cancels a planned invoice as soon as a check finds what holds it', async () => {
    const c = await trained('wb-checks-05');
    const created = (await c.call('/invoices', 'POST', { draft: withOrder(2) }, 201)) as Detail;
    expect(created.autopilot.at).not.toBeNull();
    await c.includeOrders(orderC9(500));
    await checkNow(database.db, c.id, clock);
    const after = await c.detail(created.id);
    expect(after.autopilot.at).toBeNull();
    expect(after.events.filter((e) => e.event === 'autopilot_cancelled')).toHaveLength(1);
  });
});

describe('links a person decides', () => {
  it('asks between two orders, and keeps « Oui » and « Non » from one check to the next', async () => {
    const c = await company('wb-checks-06');
    await c.includeOrders(
      orders(
        ['C-201', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40],
        ['C-202', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40],
      ),
    );
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-050', null, 'Chaise pliante', 10, 40)));
    await checkNow(database.db, c.id, clock);
    const asked = await c.checks();
    expect(asked.links.map((l) => [l.from?.number, l.to?.number, l.kind])).toEqual([
      ['C-201', 'F-2026-050', 'billed_by'],
      ['C-202', 'F-2026-050', 'billed_by'],
    ]);

    const [first] = asked.links;
    const decided = (await c.call(`/links/${first?.id}`, 'POST', {
      status: 'confirmed',
    })) as Checks;
    // The invoice is settled: the other order is no proposal any more.
    expect(decided.links).toEqual([]);
    const stored = await database.db.select().from(links).where(eq(links.tenantId, c.id));
    expect(stored.map((l) => [l.status, l.method])).toEqual([['confirmed', 'item']]);
    expect(stored[0]?.decidedBy).toBe('key');
    expect(await c.audits('link.confirm')).toHaveLength(1);

    // Checked again after a change: the « Oui » stays.
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-050', null, 'Chaise pliante', 10, 39)));
    await checkNow(database.db, c.id, clock);
    const still = await database.db.select().from(links).where(eq(links.tenantId, c.id));
    expect(still.map((l) => l.status)).toEqual(['confirmed']);
    // …and the rules read it: 10 € missing against the confirmed order.
    expect((await c.checks()).findings.map((f) => [f.rule, f.amount])).toEqual([['B1', 1_000]]);

    // « Non » on a link found by number: it is never proposed again.
    const other = await company('wb-checks-07');
    await other.includeOrders(orders(['C-301', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await other.syncInvoices(
      invoiceSheet(invoiceRow('F-2026-060', null, 'Chaise pliante', 10, 40)),
    );
    await checkNow(database.db, other.id, clock);
    const [auto] = await database.db.select().from(links).where(eq(links.tenantId, other.id));
    expect(auto).toMatchObject({ status: 'auto', method: 'item' });
    await other.call(`/links/${auto?.id}`, 'POST', { status: 'rejected' });
    await runChecks(database.db, other.id, clock);
    const rejected = await database.db.select().from(links).where(eq(links.tenantId, other.id));
    expect(rejected.map((l) => l.status)).toEqual(['rejected']);
    expect(await other.audits('link.reject')).toHaveLength(1);
    await other.call(
      '/links/00000000-0000-4000-8000-000000000000',
      'POST',
      { status: 'rejected' },
      404,
    );
  });
});

describe('the sweep', () => {
  it('checks a company again when its registry moved, and every new day', async () => {
    const c = await company('wb-checks-08');
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    expect(await checksBehind(database.db, clock)).toContain(c.id);
    await checkNow(database.db, c.id, clock);
    expect(await checksBehind(database.db, clock)).not.toContain(c.id);
    await c.syncOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 12, 40]));
    expect(await checksBehind(database.db, clock)).toContain(c.id);
    await checkNow(database.db, c.id, clock);
    expect(await checksBehind(database.db, clock)).not.toContain(c.id);
    const tomorrow = new Date(clock.getTime() + 86_400_000);
    expect(await checksBehind(database.db, tomorrow)).toContain(c.id);
    const [state] = await database.db
      .select()
      .from(checkState)
      .where(eq(checkState.tenantId, c.id));
    expect(state?.checkedOn).toBe('2026-10-20');
  });
});

describe('RGPD', () => {
  it('exports the links and findings, and erases them with the account', async () => {
    const c = await company('wb-checks-09');
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    const data = (await c.call('/tenant/export')) as {
      registry: {
        documents: { id: string; number: string | null }[];
        links: { kind: string; from: string; to: string; status: string }[];
        findings: { rule: string; message: string; amount: number; document: string }[];
        checkedAt: string | null;
      };
    };
    const ids = new Map(data.registry.documents.map((x) => [x.id, x.number]));
    expect(data.registry.links.map((l) => [ids.get(l.from), ids.get(l.to), l.status])).toEqual([
      ['C-118', 'F-2026-042', 'auto'],
    ]);
    expect(data.registry.findings).toEqual([
      expect.objectContaining({ rule: 'B1', message: 'B1.under', amount: 10_000 }),
    ]);
    expect(data.registry.checkedAt).toBe(clock.toISOString());

    await c.call('/tenant', 'DELETE', { confirmSiren: '100000009' });
    for (const table of [links, findings, checkState]) {
      expect(await database.db.select().from(table).where(eq(table.tenantId, c.id))).toEqual([]);
    }
  });
});
