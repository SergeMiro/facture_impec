// Patterns and learning (R7), end to end: a price unusual for the customer (B7) found from the invoice
// sheet's history, « C'est normal » that keeps a finding quiet for its customer and article until its
// end and « Retirer » that brings it back, « Est-ce le même article ? » that gives a sold article the
// cost of a bought one, the money not invoiced in the weekly report, and the RGPD export and erasure.
import { type GridCell, grid } from '@fi/core';
import type { Database } from '@fi/db';
import { eq, itemSynonyms, ruleExceptions, tenants } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkNow } from './checks';
import {
  type Checks,
  companies,
  d,
  INVOICE_HEADER,
  invoiceRow,
  invoiceSheet,
  orders,
  SEP1,
} from './checks.fixtures';
import { lastDay } from './patterns';
import { weekFacts } from './report';
import { fakeAdapter, testApi, testDatabase } from './test-helpers';

const adapter = fakeAdapter({ lookupRecipient: async ({ siren }) => ({ siren }) });

let database: Database;
let api: ReturnType<typeof testApi>;
let clock = new Date('2026-10-20T08:00:00Z');

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: adapter }, undefined, { now: () => clock });
});
afterAll(async () => {
  await database.close();
});

const company = (workbook: string) => companies({ request: api.request, database })(workbook);

interface View extends Checks {
  findings: (Checks['findings'][number] & {
    normal: { customer: string | null } | null;
  })[];
  synonyms: { id: string; sold: string; bought: string; score: number }[];
  exceptions: {
    id: string;
    rule: string;
    customer: string | null;
    oneCustomer: boolean;
    item: string;
    until: string | null;
  }[];
}

/** An invoice row dated otherwise than 10 September. */
const dated = (date: GridCell, ...row: Parameters<typeof invoiceRow>) => {
  const cells = invoiceRow(...row);
  cells[1] = date;
  return cells;
};
const JUN10 = d(46183, '10/06/2026');
const JUL10 = d(46213, '10/07/2026');
const AUG10 = d(46244, '10/08/2026');

const purchases = (...rows: GridCell[][]) =>
  grid('Achats', [
    ['N° achat', 'Date', 'Fournisseur', 'Désignation', 'Qté', 'Prix d’achat HT'],
    ...rows,
  ]);

async function tenantRow(id: string) {
  const [row] = await database.db.select().from(tenants).where(eq(tenants.id, id));
  if (!row) throw new Error('gone');
  return row;
}

describe('B7, a price unusual for the customer', () => {
  it('finds two days billed at an hour’s price, and counts it as money not invoiced', async () => {
    const c = await company('wb-patterns-01');
    await c.syncInvoices(
      invoiceSheet(
        dated(JUN10, 'F-1', null, 'Journée de conseil', 3, 400),
        dated(JUL10, 'F-2', null, 'Journée de conseil', 1, 400),
        dated(AUG10, 'F-3', null, 'Journée de conseil', 2, 420),
        invoiceRow('F-4', null, 'Journée de conseil', 2, 50),
      ),
    );
    await checkNow(database.db, c.id, clock);
    const view = (await c.checks()) as View;
    expect(view.findings).toHaveLength(1);
    const [b7] = view.findings;
    expect(b7).toMatchObject({ rule: 'B7', severity: 'warning', amount: 70_000 });
    expect(b7?.message.replace(/\u00a0|\u202f/g, ' ')).toBe(
      "Sur la facture F-4, « Journée de conseil » est à 50,00 € pour Durand SARL, alors que ses 3 factures précédentes l'ont autour de 400,00 € : 700,00 € de moins sur 2. Vérifiez le prix et l'unité (heures ou jours) ; si c'est un prix accordé, dites-le avec « C'est normal ».",
    );
    expect(b7?.evidence).toEqual([
      expect.objectContaining({ role: 'invoice', number: 'F-4', cell: 'Factures!K5' }),
      expect.objectContaining({ role: 'history', number: 'F-3', cell: 'Factures!K4' }),
    ]);
    expect(b7?.normal).toEqual({ customer: 'Durand SARL' });
    // A warning holds nothing.
    expect(view.blocking).toBe(0);

    const facts = await weekFacts(api.deps, await tenantRow(c.id), clock);
    expect(facts.notInvoiced).toEqual({ count: 1, amount: 70_000 });
    const report = (await c.call('/report')) as { numbers: string[] };
    expect(report.numbers.map((n) => n.replace(/\u00a0|\u202f/g, ' '))).toContain(
      'Manque à facturer repéré : 1 écart(s), 700,00 € (onglet « Contrôles »)',
    );
    // A week later it is no longer this week's news.
    expect(
      (await weekFacts(api.deps, await tenantRow(c.id), new Date('2026-10-28T08:00:00Z')))
        .notInvoiced,
    ).toEqual({ count: 0, amount: 0 });
  });
});

describe("« C'est normal »", () => {
  it('keeps the finding quiet for its customer and article until its end; « Retirer » brings it back', async () => {
    clock = new Date('2026-10-20T08:00:00Z');
    const c = await company('wb-patterns-02');
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    const [b1] = ((await c.checks()) as View).findings;
    expect(b1).toMatchObject({
      rule: 'B1',
      severity: 'blocking',
      normal: { customer: 'Durand SARL' },
    });
    const id = await c.invoiceId('F-2026-042');
    expect((await c.detail(id)).findings.map((f) => f.severity)).toEqual(['blocking']);

    await c.call(
      '/findings/00000000-0000-4000-8000-000000000000/normal',
      'POST',
      { months: 3 },
      404,
    );
    const after = (await c.call(`/findings/${b1?.id}/normal`, 'POST', {
      everyCustomer: false,
      months: 3,
    })) as View;
    expect(after.findings).toEqual([]);
    expect(after.blocking).toBe(0);
    expect(after.exceptions).toEqual([
      expect.objectContaining({
        rule: 'B1',
        customer: 'Durand SARL',
        oneCustomer: true,
        item: 'Chaise pliante',
        until: '2027-01-19',
      }),
    ]);
    expect(lastDay('2026-10-20', 3)).toBe('2027-01-19');
    const [audit] = await c.audits('finding.normal');
    expect(audit).toMatchObject({ actor: 'user', objectType: 'finding', objectId: b1?.id });
    // Nothing holds the invoice any more; the next check reads the exception.
    expect((await c.detail(id)).findings).toEqual([]);
    expect(await checkNow(database.db, c.id, clock)).toBeNull();
    // Once resolved, the finding is not answered again.
    await c.call(`/findings/${b1?.id}/normal`, 'POST', { months: 12 }, 409);

    // Its last day still counts; the day after, the finding is back.
    clock = new Date('2027-01-19T08:00:00Z');
    await checkNow(database.db, c.id, clock);
    expect(((await c.checks()) as View).findings).toEqual([]);
    clock = new Date('2027-01-20T08:00:00Z');
    await checkNow(database.db, c.id, clock);
    const back = (await c.checks()) as View;
    expect(back.findings.map((f) => f.rule)).toEqual(['B1']);
    expect(back.exceptions).toEqual([]);

    // Every customer, no end; then « Retirer ».
    const [again] = back.findings;
    const quiet = (await c.call(`/findings/${again?.id}/normal`, 'POST', {
      everyCustomer: true,
      months: null,
    })) as View;
    expect(quiet.exceptions).toEqual([
      expect.objectContaining({ customer: null, oneCustomer: false, until: null }),
    ]);
    const [exception] = quiet.exceptions;
    const removed = (await c.call(`/exceptions/${exception?.id}`, 'DELETE')) as View;
    expect(removed.exceptions).toEqual([]);
    expect(removed.findings.map((f) => f.rule)).toEqual(['B1']);
    expect(await c.audits('exception.remove')).toHaveLength(1);
    await c.call(`/exceptions/${exception?.id}`, 'DELETE', undefined, 404);
    await c.call(`/findings/${again?.id}/normal`, 'POST', { months: 6 }, 400);
  });

  it('is not offered on a sum, a VAT rate or a delivery left unbilled', async () => {
    const c = await company('wb-patterns-03');
    // The order's customer is not the invoice's (B6): not a price to agree.
    await c.includeOrders(orders(['C-118', SEP1, 'Martin SA', 'Chaise pliante', 10, 40]));
    const other = invoiceRow('F-7', 'C-118', 'Chaise pliante', 10, 40);
    await c.syncInvoices(grid('Factures', [INVOICE_HEADER, other]));
    await checkNow(database.db, c.id, clock);
    const view = (await c.checks()) as View;
    const b6 = view.findings.find((f) => f.rule === 'B6');
    expect(b6?.normal).toBeNull();
    await c.call(`/findings/${b6?.id}/normal`, 'POST', { months: 3 }, 409);
  });
});

describe('« Est-ce le même article ? »', () => {
  it('ties a bought article to a sold one: B2 finds the cost; « Non » never asks again', async () => {
    const c = await company('wb-patterns-04');
    const snapshot = purchases(['A-1', SEP1, 'Dupont Négoce', 'GM chaise pliante pin', 20, 35]);
    const base = `/workbooks/wb-patterns-04/sources`;
    const { layout } = (await c.call(`${base}/detect`, 'POST', { snapshot })) as {
      layout: unknown;
    };
    await c.call(`${base}/Achats`, 'PUT', { layout, snapshot });
    await c.syncInvoices(invoiceSheet(invoiceRow('F-60', null, 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    const asked = (await c.checks()) as View;
    expect(asked.findings).toEqual([]);
    expect(asked.synonyms).toEqual([
      expect.objectContaining({
        sold: 'Chaise pliante',
        bought: 'GM chaise pliante pin',
        score: 100,
      }),
    ]);
    const [pair] = asked.synonyms;
    const tied = (await c.call(`/synonyms/${pair?.id}`, 'POST', { status: 'confirmed' })) as View;
    expect(tied.synonyms).toEqual([]);
    const [loss] = tied.findings;
    expect(loss).toMatchObject({ rule: 'B2', severity: 'blocking', amount: 5_000 });
    expect(loss?.message).toContain("(l'achat A-1 de la feuille « Achats »)");
    expect(await c.audits('synonym.confirm')).toHaveLength(1);

    // « Non » on it now: the articles part, and the pair is not proposed again.
    const parted = (await c.call(`/synonyms/${pair?.id}`, 'POST', { status: 'rejected' })) as View;
    expect(parted.findings).toEqual([]);
    expect(parted.synonyms).toEqual([]);
    expect(await c.audits('synonym.reject')).toHaveLength(1);
    await c.call(
      '/synonyms/00000000-0000-4000-8000-000000000000',
      'POST',
      { status: 'confirmed' },
      404,
    );
  });
});

describe('RGPD', () => {
  it('exports the exceptions and the article pairs, and erases them with the account', async () => {
    clock = new Date('2026-10-20T08:00:00Z');
    const c = await company('wb-patterns-05');
    await c.includeOrders(orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 40]));
    const snapshot = purchases(['A-1', SEP1, 'Dupont Négoce', 'Table pliante bois', 2, 80]);
    const base = `/workbooks/wb-patterns-05/sources`;
    const { layout } = (await c.call(`${base}/detect`, 'POST', { snapshot })) as {
      layout: unknown;
    };
    await c.call(`${base}/Achats`, 'PUT', { layout, snapshot });
    await c.syncInvoices(
      invoiceSheet(
        invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30),
        invoiceRow('F-2026-043', null, 'Table pliante', 1, 150),
      ),
    );
    await checkNow(database.db, c.id, clock);
    const view = (await c.checks()) as View;
    await c.call(`/findings/${view.findings[0]?.id}/normal`, 'POST', { months: 12 });
    expect(view.synonyms).toHaveLength(1);
    await c.call(`/synonyms/${view.synonyms[0]?.id}`, 'POST', { status: 'rejected' });

    const data = (await c.call('/tenant/export')) as {
      registry: {
        exceptions: { rule: string; partyName: string | null; itemName: string; until: string }[];
        synonyms: { status: string }[];
      };
    };
    expect(data.registry.exceptions).toEqual([
      expect.objectContaining({
        rule: 'B1',
        partyName: 'Durand SARL',
        itemName: 'Chaise pliante',
        until: '2027-10-19',
      }),
    ]);
    expect(data.registry.synonyms).toEqual([expect.objectContaining({ status: 'rejected' })]);

    await c.call('/tenant', 'DELETE', { confirmSiren: '100000009' });
    for (const table of [ruleExceptions, itemSynonyms]) {
      expect(await database.db.select().from(table).where(eq(table.tenantId, c.id))).toEqual([]);
    }
  });
});
