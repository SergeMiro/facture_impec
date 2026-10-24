// Purchases and margin (R3), end to end: a supplier invoice the platform delivers and a row of the
// « Achats » sheet give a sold line its cost; « produit vendu sous son prix d'achat » blocks the send,
// a margin under the company's minimum warns, « Ce n'est pas le même article » makes the next purchase
// count, and the supplier joins the company's parties without becoming a customer. R6: a supplier's
// Factur-X uploaded from the pane gives the cost the same way.
import { detectMapping, type GridCell, grid, toCii } from '@fi/core';
import { toFacturXPdf } from '@fi/core/pdf';
import type { Database } from '@fi/db';
import { and, auditEvents, docs, eq, links, parties } from '@fi/db';
import type { InboundInvoice } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkNow } from './checks';
import { supplierDocument } from './checks.fixtures';
import {
  FONTS,
  fakeAdapter,
  newTenant,
  type RecordedJobs,
  testAi,
  testApi,
  testDatabase,
} from './test-helpers';
import { runInboundPoll, type WorkerDeps } from './workers';

const delivered = new Map<string, InboundInvoice[]>();
const adapter = fakeAdapter({
  lookupRecipient: async ({ siren }) => ({ siren }),
  listInbound: async ({ account, since }) =>
    (delivered.get(account) ?? []).filter((i) => Date.parse(i.receivedAt) >= since.getTime()),
});

let database: Database;
let api: ReturnType<typeof testApi>;
let jobs: RecordedJobs;
const clock = new Date('2026-10-20T08:00:00Z');

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: adapter }, undefined, { now: () => clock });
  ({ jobs } = api);
});
afterAll(async () => {
  await database.close();
});

const d = (serial: number, text: string): GridCell => ({ v: serial, t: text, f: 'dd/mm/yyyy' });
const AUG20 = d(46254, '20/08/2026');
const SEP1 = d(46266, '01/09/2026');
const SEP5 = d(46270, '05/09/2026');
const SEP10 = d(46275, '10/09/2026');

const orders = (...rows: GridCell[][]) =>
  grid('Commandes', [['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'], ...rows]);
const purchases = (...rows: GridCell[][]) =>
  grid('Achats', [
    ['N° achat', 'Date', 'Fournisseur', 'Désignation', 'Qté', 'Prix d’achat HT'],
    ...rows,
  ]);
const invoiceSheet = (number: string, order: string | null, quantity: number, price: number) =>
  grid('Factures', [
    [
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
    ],
    [
      number,
      SEP10,
      'Durand SARL',
      '200000008',
      '3 rue de la Gare',
      '21000',
      'Dijon',
      order,
      'Chaise pliante',
      quantity,
      price,
      { v: 0.2, t: '20%', f: '0%' },
    ],
  ]);

const supplierInvoice = (number: string, price: string) => toCii(supplierDocument(number, price));

interface Finding {
  rule: string;
  severity: string;
  message: string;
  amount: number | null;
  costLinkId: string | null;
  evidence: {
    role: string;
    number: string | null;
    sheet: string | null;
    cell: string | null;
    inboundId: string | null;
    file: string | null;
  }[];
}

let received = 0;

async function company(workbook: string) {
  const t = await newTenant(api.request, {
    vatId: 'FR88100000009',
    address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
  });
  const call = async (path: string, method = 'GET', body?: unknown, status = 200) => {
    const res = await api.request(path, {
      method,
      token: t.apiKey,
      ...(body !== undefined && { body }),
    });
    expect(res.status, await res.clone().text()).toBe(status);
    return res.json();
  };
  await call('/settings', 'PATCH', {
    invoiceDefaults: {
      siret: '10000000900017',
      iban: 'FR7630006000011234567890189',
      paymentDays: 30,
      operationCategory: 'goods',
    },
  });
  const include = async (snapshot: ReturnType<typeof grid>) => {
    const base = `/workbooks/${workbook}/sources`;
    const { layout } = (await call(`${base}/detect`, 'POST', { snapshot })) as { layout: unknown };
    return call(`${base}/${encodeURIComponent(snapshot.sheet)}`, 'PUT', { layout, snapshot });
  };
  const worker = (): WorkerDeps => ({
    db: database.db,
    pdp: { mock: adapter },
    test: null,
    jobs,
    ai: testAi(database),
    mailer: null,
    now: () => new Date(),
  });
  return {
    ...t,
    call,
    include,
    syncInvoices: (snapshot: ReturnType<typeof grid>) =>
      call(`/workbooks/${workbook}/sync`, 'POST', { snapshot, mapping: detectMapping(snapshot) }),
    /** The platform delivers a supplier invoice and the sweep polls. */
    async deliver(xml: string) {
      const list = delivered.get(t.account) ?? [];
      const receivedAt = new Date(Date.now() + ++received * 1000).toISOString();
      list.push({ pdpRef: `purchase-${received}`, receivedAt, xml });
      delivered.set(t.account, list);
      return runInboundPoll(worker());
    },
    findings: async () =>
      ((await call('/checks')) as { findings: Finding[]; atStake: number }).findings,
    check: () => checkNow(database.db, t.id, clock),
    suppliers: () =>
      database.db
        .select()
        .from(parties)
        .where(and(eq(parties.tenantId, t.id), eq(parties.kind, 'supplier'))),
  };
}

describe('a supplier invoice received through the platform', () => {
  it('gives the cost: 300/400 sold 10 × 35 € bought is 100 € missing and 50 € lost', async () => {
    const c = await company('wb-purchases-01');
    expect(await c.deliver(supplierInvoice('FA-2026-311', '35.00'))).toMatchObject({ stored: 1 });
    await c.include(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await c.syncInvoices(invoiceSheet('F-2026-042', 'C-118', 10, 30));
    await c.check();

    const view = (await c.call('/checks')) as { atStake: number; findings: Finding[] };
    const byRule = new Map(view.findings.map((f) => [f.rule, f]));
    expect(byRule.get('B1')).toMatchObject({ severity: 'blocking', amount: 10_000 });
    const b2 = byRule.get('B2');
    expect(b2).toMatchObject({ severity: 'blocking', amount: 5_000 });
    expect(b2?.message).toBe(
      "Sur la facture F-2026-042, vous vendez 10 « Chaise pliante » à 30,00\u00a0€ l'unité, en dessous de votre prix d'achat de 35,00\u00a0€ (la facture FA-2026-311 de Grossiste Martin SAS) : 50,00\u00a0€ de perte.",
    );
    // « Voir la facture du fournisseur » opens it in « Réception ».
    const purchase = b2?.evidence.find((e) => e.role === 'purchase');
    expect(purchase).toMatchObject({ number: 'FA-2026-311', sheet: null, cell: null });
    expect(purchase?.inboundId).toEqual(expect.any(String));
    const inbound = (await c.call(`/inbound/${purchase?.inboundId}`)) as { number: string };
    expect(inbound.number).toBe('FA-2026-311');
    const [cost] = await database.db
      .select()
      .from(links)
      .where(and(eq(links.tenantId, c.id), eq(links.kind, 'cost')));
    // The supplier's reference is not the company's: the same name links it.
    expect(cost).toMatchObject({ method: 'similarity', status: 'auto', score: 80 });
    expect(b2?.costLinkId).toBe(cost?.id);

    // The supplier joins the parties as its invoice names it; « Clients » does not list it.
    const [supplier] = await c.suppliers();
    expect(supplier).toMatchObject({
      legalName: 'Grossiste Martin SAS',
      siren: '600000004',
      source: 'invoice',
      verifiedAt: null,
      names: [],
    });
    const clients = (await c.call('/parties')) as { parties: { siren: string }[] };
    expect(clients.parties.map((p) => p.siren)).not.toContain('600000004');
    await c.call(`/parties/${supplier?.id}`, 'PATCH', { autopilot: true }, 404);
    expect(await c.call('/registry')).toMatchObject({ suppliers: 1 });
    // The account's export gives them apart from the customers.
    const exported = (await c.call('/tenant/export')) as {
      customers: unknown[];
      suppliers: { siren: string; source: string }[];
    };
    expect(exported.customers).toEqual([]);
    expect(exported.suppliers).toMatchObject([{ siren: '600000004', source: 'invoice' }]);

    // Both findings block « Envoyer ».
    const [row] = ((await c.call('/checks')) as { findings: { invoiceId: string }[] }).findings;
    const sent = await api.request(`/invoices/${row?.invoiceId}/send`, {
      method: 'POST',
      token: c.apiKey,
    });
    expect(sent.status).toBe(409);

    // A second invoice from the same supplier leaves its party as it was.
    await c.deliver(supplierInvoice('FA-2026-312', '35.00'));
    await c.check();
    expect(await c.suppliers()).toHaveLength(1);
  });
});

describe('the « Achats » sheet', () => {
  it('gives the cost; « Non » takes the purchase before; the margin of « Réglages » warns', async () => {
    const c = await company('wb-purchases-02');
    await c.include(
      purchases(
        ['A-1', AUG20, 'Dupont Négoce', 'Chaise pliante', 20, 28],
        ['A-2', SEP5, 'Dupont Négoce', 'Chaise pliante', 20, 35],
      ),
    );
    await c.syncInvoices(invoiceSheet('F-60', null, 10, 30));
    await c.check();
    const [loss] = await c.findings();
    expect(loss).toMatchObject({ rule: 'B2', severity: 'blocking', amount: 5_000 });
    expect(loss?.message).toContain("(l'achat A-2 de la feuille « Achats »)");
    expect(loss?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'purchase', sheet: 'Achats', cell: 'Achats!D3' }),
        expect.objectContaining({ role: 'invoice', cell: 'Factures!K2' }),
      ]),
    );
    // A Achats sheet row is not a supplier with a SIREN: no party.
    expect(await c.suppliers()).toEqual([]);

    // « Ce n'est pas le même article »: A-1, bought at 28 €, gives the cost now.
    await c.call(`/links/${loss?.costLinkId}`, 'POST', { status: 'rejected' });
    await c.check();
    expect(await c.findings()).toEqual([]);

    // A margin of 20 %: 28 € / 0,8 = 35 €, 5 € short on each of the 10 chairs.
    const queued = jobs.registry.length;
    const settings = (await c.call('/settings', 'PATCH', { minMarginPercent: 20 })) as {
      minMarginPercent: number | null;
    };
    expect(settings.minMarginPercent).toBe(20);
    expect(jobs.registry.slice(queued)).toContain(c.id);
    expect(await c.check()).toMatchObject({ open: 1 });
    const [margin] = await c.findings();
    expect(margin).toMatchObject({ rule: 'B2', severity: 'warning', amount: 5_000 });
    expect(margin?.message).toContain('votre marge est de 6,7 %, sous les 20 %');
    // The invoice defaults, then the margin.
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, c.id), eq(auditEvents.action, 'settings.update')));
    expect(audits).toHaveLength(2);

    await c.call('/settings', 'PATCH', { minMarginPercent: 0 }, 400);
    await c.call('/settings', 'PATCH', { minMarginPercent: null });
    await c.check();
    expect(await c.findings()).toEqual([]);
  });
});

describe('« Mode test » supplier invoices', () => {
  it('give no supplier to the parties', async () => {
    const c = await company('wb-purchases-03');
    await c.call('/inbound/test', 'POST', { kind: 'normal' }, 201);
    await c.check();
    expect(await c.suppliers()).toEqual([]);
  });
});

describe('a supplier invoice uploaded from the pane (R6)', () => {
  it('gives the cost: its Factur-X uploaded, B2 finds the 50 € lost; delivered later, it counts once', async () => {
    const c = await company('wb-purchases-r6');
    const pdf = await toFacturXPdf(supplierDocument('FA-2026-411', '35.00'), {
      fonts: FONTS,
      now: clock,
    });
    const added = await c.call('/uploads?name=Facture FA-2026-411.pdf', 'POST', pdf);
    expect(added).toMatchObject({
      replaced: false,
      upload: {
        name: 'Facture FA-2026-411.pdf',
        format: 'facturx',
        kind: 'invoice',
        sheets: [],
        invoice: {
          number: 'FA-2026-411',
          supplier: 'Grossiste Martin SAS',
          lines: 1,
          netTotal: 35_000,
          received: false,
        },
      },
    });
    await c.syncInvoices(invoiceSheet('F-2026-142', null, 10, 30));
    await c.check();

    const b2 = (await c.findings()).find((f) => f.rule === 'B2');
    expect(b2).toMatchObject({ severity: 'blocking', amount: 5_000 });
    expect(b2?.message).toBe(
      "Sur la facture F-2026-142, vous vendez 10 « Chaise pliante » à 30,00\u00a0€ l'unité, en dessous de votre prix d'achat de 35,00\u00a0€ (la facture FA-2026-411 de Grossiste Martin SAS) : 50,00\u00a0€ de perte.",
    );
    // The pane names the file it came from; nothing opens in « Réception ».
    expect(b2?.evidence.find((e) => e.role === 'purchase')).toMatchObject({
      number: 'FA-2026-411',
      inboundId: null,
      file: 'Facture FA-2026-411.pdf',
    });
    expect(await c.suppliers()).toMatchObject([{ siren: '600000004', source: 'invoice' }]);
    expect(await c.call('/inbound')).toEqual({ inbound: [], subcontractors: null });

    // The platform delivers the same invoice: the registry keeps the received one only.
    await c.deliver(supplierInvoice('FA-2026-411', '35.00'));
    await c.check();
    const bought = await database.db
      .select()
      .from(docs)
      .where(and(eq(docs.tenantId, c.id), eq(docs.direction, 'in')));
    expect(bought).toHaveLength(1);
    expect(bought[0]?.inboundId).toEqual(expect.any(String));
    const [again] = (await c.findings()).filter((f) => f.rule === 'B2');
    expect(again).toMatchObject({ amount: 5_000 });
    expect(again?.evidence.find((e) => e.role === 'purchase')?.inboundId).toEqual(
      expect.any(String),
    );
    expect(await c.call('/uploads')).toMatchObject({
      uploads: [{ name: 'Facture FA-2026-411.pdf', invoice: { received: true } }],
    });

    // Removing the file leaves the received invoice's cost.
    const [upload] = ((await c.call('/uploads')) as { uploads: { id: string }[] }).uploads;
    expect(await c.call(`/uploads/${upload?.id}`, 'DELETE')).toEqual({ uploads: [] });
    await c.check();
    expect((await c.findings()).filter((f) => f.rule === 'B2')).toMatchObject([{ amount: 5_000 }]);
  });
});
