// The registry (R0): every invoice of the company as a document and its lines, each tied to an
// article; projected again only when the invoice changed, removed when it was cancelled, received
// invoices once read; queued after a sync that changed something, caught up by the sweep.
import { detectMapping, type GridCell, grid } from '@fi/core';
import type { Database } from '@fi/db';
import { asc, docLines, docs, eq, inboundQueue, items } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemKey, normalizeName, refreshRegistry, registryBehind } from './registry';
import { SCENARIO_SELLER } from './scenarios/invoice';
import { fakeAdapter, newTenant, type RecordedJobs, testApi, testDatabase } from './test-helpers';
import type { SyncResult } from './workbooks';

let database: Database;
let request: ReturnType<typeof testApi>['request'];
let jobs: RecordedJobs;

beforeAll(async () => {
  database = await testDatabase();
  ({ request, jobs } = testApi(database, { mock: fakeAdapter() }));
});
afterAll(async () => {
  await database.close();
});

const HEADER: GridCell[] = [
  'N° Facture',
  'Date',
  'Client',
  'SIREN',
  'Adresse',
  'Code postal',
  'Ville',
  'Désignation',
  'Qté',
  'P.U. HT',
  'TVA',
];
const line = (number: string | null, item: string, quantity = 1, price = 450): GridCell[] => [
  number,
  number ? { v: 46310, t: '15/10/2026', f: 'dd/mm/yyyy' } : null,
  number ? 'Martin' : null,
  number ? '200000008' : null,
  number ? '3 rue de la Gare' : null,
  number ? '21000' : null,
  number ? 'Dijon' : null,
  item,
  quantity,
  price,
  { v: 0.2, t: '20%', f: '0%' },
];
const sheet = (...rows: GridCell[][]) => grid('Factures', [HEADER, ...rows]);

async function company() {
  const t = await newTenant(request, {
    vatId: 'FR88100000009',
    address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
  });
  await request('/settings', {
    method: 'PATCH',
    token: t.apiKey,
    body: {
      invoiceDefaults: {
        siret: '10000000900017',
        iban: 'FR7630006000011234567890189',
        paymentDays: 30,
        operationCategory: 'services',
      },
    },
  });
  const sync = async (snapshot: ReturnType<typeof sheet>) => {
    const res = await request(`/workbooks/wb-registry/sync`, {
      method: 'POST',
      token: t.apiKey,
      body: { snapshot, mapping: detectMapping(snapshot) },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResult;
  };
  const refresh = () => refreshRegistry(database.db, t.id, new Date());
  const registry = async () => {
    const documents = await database.db
      .select()
      .from(docs)
      .where(eq(docs.tenantId, t.id))
      .orderBy(asc(docs.number));
    const lines = await database.db
      .select({ docId: docLines.docId, name: docLines.name, key: items.key, cell: docLines.cell })
      .from(docLines)
      .leftJoin(items, eq(items.id, docLines.itemId))
      .where(eq(docLines.tenantId, t.id))
      .orderBy(asc(docLines.cell), asc(docLines.id));
    return { documents, lines };
  };
  return { tenant: t, sync, refresh, registry };
}

describe('item keys', () => {
  it("reads the company's own reference first, else the name", () => {
    const base = { allowances: [], charges: [], price: {}, vat: {} };
    const sold = { ...base, item: { name: 'Journée  de Conseil.', sellerId: ' ab-12 ' } };
    expect(itemKey('out', sold, null)).toBe('ref:AB-12');
    expect(itemKey('out', { ...base, item: { name: 'Journée  de Conseil.' } }, null)).toBe(
      'name:journee de conseil',
    );
    expect(itemKey('out', { ...base, item: {} }, null)).toBeNull();
    // Bought: the company's reference is the buyer's identifier; else the supplier's article.
    const bought = { ...base, item: { name: 'Vis M6', sellerId: 'V-6', buyerId: 'ab-12' } };
    expect(itemKey('in', bought, '300000004')).toBe('ref:AB-12');
    expect(
      itemKey('in', { ...bought, item: { name: 'Vis M6', sellerId: 'V-6' } }, '300000004'),
    ).toBe('supplier:300000004:ref:V-6');
    expect(itemKey('in', { ...base, item: { name: 'Vis M6' } }, '300000004')).toBe(
      'supplier:300000004:name:vis m6',
    );
    expect(normalizeName('Œuvre — Été 2026 !')).toBe('œuvre ete 2026');
  });
});

describe('the registry', () => {
  it('holds every invoice line by line, and projects again only what changed', async () => {
    const c = await company();
    await c.sync(
      sheet(
        line('F-1', 'Journée de conseil', 2),
        line(null, 'Déplacement', 1, 80),
        line('F-2', 'journée de CONSEIL'),
      ),
    );
    expect(await registryBehind(database.db)).toContain(c.tenant.id);
    expect(await c.refresh()).toEqual({ projected: 2, removed: 0 });
    expect(await registryBehind(database.db)).not.toContain(c.tenant.id);
    const first = await c.registry();
    expect(first.documents.map((d) => [d.number, d.direction, d.netTotal, d.isTest])).toEqual([
      ['F-1', 'out', 98_000, false],
      ['F-2', 'out', 45_000, false],
    ]);
    expect(first.lines.map((l) => [l.name, l.key, l.cell])).toEqual([
      ['Journée de conseil', 'name:journee de conseil', 'Factures!H2'],
      ['Déplacement', 'name:deplacement', 'Factures!H3'],
      ['journée de CONSEIL', 'name:journee de conseil', 'Factures!H4'],
    ]);
    expect(await c.refresh()).toEqual({ projected: 0, removed: 0 });

    // One quantity changed: that invoice only, its lines replaced.
    await c.sync(
      sheet(
        line('F-1', 'Journée de conseil', 3),
        line(null, 'Déplacement', 1, 80),
        line('F-2', 'journée de CONSEIL'),
      ),
    );
    expect(await c.refresh()).toEqual({ projected: 1, removed: 0 });
    const second = await c.registry();
    expect(second.documents.map((d) => d.netTotal)).toEqual([143_000, 45_000]);
    expect(second.lines).toHaveLength(3);

    // A row removed: its invoice is cancelled and leaves the registry.
    await c.sync(sheet(line('F-1', 'Journée de conseil', 3), line(null, 'Déplacement', 1, 80)));
    expect(await c.refresh()).toEqual({ projected: 0, removed: 1 });
    expect((await c.registry()).documents.map((d) => d.number)).toEqual(['F-1']);
  });

  it("ties a line to the company's article reference when the sheet has one", async () => {
    const c = await company();
    const withRef = grid('Factures', [
      [...HEADER, 'Réf article', 'Remise'],
      [...line('F-1', 'Vis inox 6×40', 10, 8.4), 'vis-6', 4],
      [...line('F-2', 'Vis inox (boîte)', 2, 8.4), 'VIS-6', null],
    ]);
    await c.sync(withRef);
    expect(await c.refresh()).toEqual({ projected: 2, removed: 0 });
    const { documents, lines } = await c.registry();
    expect(lines.map((l) => [l.key, l.cell])).toEqual([
      ['ref:VIS-6', 'Factures!H2'],
      ['ref:VIS-6', 'Factures!H3'],
    ]);
    // 10 × 8,40 − 4,00 of discount.
    expect(documents.map((d) => d.netTotal)).toEqual([8_000, 1_680]);
    const [discounted] = await database.db
      .select({ discount: docLines.discount, sellerRef: docLines.sellerRef })
      .from(docLines)
      .where(eq(docLines.tenantId, c.tenant.id))
      .orderBy(asc(docLines.cell));
    expect(discounted).toEqual({ discount: 400, sellerRef: 'vis-6' });
  });

  it('is queued after a sync that changed something, not after one that did not', async () => {
    const c = await company();
    const rows = sheet(line('F-1', 'Journée de conseil'));
    jobs.registry.length = 0;
    await c.sync(rows);
    expect(jobs.registry).toEqual([c.tenant.id]);
    await c.sync(rows);
    expect(jobs.registry).toEqual([c.tenant.id]);
  });

  it('holds received invoices once read, under the supplier', async () => {
    const c = await company();
    await request('/settings', {
      method: 'PATCH',
      token: c.tenant.apiKey,
      body: { sandboxEnabled: true },
    });
    jobs.registry.length = 0;
    const res = await request('/inbound/test', {
      method: 'POST',
      token: c.tenant.apiKey,
      body: { kind: 'normal' },
    });
    expect(res.status).toBe(201);
    expect(jobs.registry).toEqual([c.tenant.id]);
    const [received] = await database.db
      .select()
      .from(inboundQueue)
      .where(eq(inboundQueue.tenantId, c.tenant.id));
    expect(await c.refresh()).toEqual({ projected: 1, removed: 0 });
    const { documents, lines } = await c.registry();
    expect(documents).toMatchObject([
      { direction: 'in', inboundId: received?.id, isTest: true, partyName: received?.supplierName },
    ]);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.key).toMatch(new RegExp(`^supplier:${received?.supplierKey}:`));
    expect(await c.refresh()).toEqual({ projected: 0, removed: 0 });
  });
});

describe('RGPD', () => {
  it('exports the registry with the account and leaves nothing of it after deletion', async () => {
    const c = await company();
    await c.sync(sheet(line('F-1', 'Journée de conseil', 2), line(null, 'Déplacement', 1, 80)));
    await c.refresh();
    const exported = (await (
      await request('/tenant/export', { token: c.tenant.apiKey })
    ).json()) as {
      registry: {
        items: { key: string; name: string }[];
        documents: { number: string; lines: { name: string; item: string; cell: string }[] }[];
      };
    };
    expect(exported.registry.items.map((i) => i.key).sort()).toEqual([
      'name:deplacement',
      'name:journee de conseil',
    ]);
    expect(exported.registry.documents).toMatchObject([
      {
        number: 'F-1',
        lines: [
          { name: 'Journée de conseil', item: 'name:journee de conseil', cell: 'Factures!H2' },
          { name: 'Déplacement', item: 'name:deplacement', cell: 'Factures!H3' },
        ],
      },
    ]);

    const deleted = await request('/tenant', {
      method: 'DELETE',
      token: c.tenant.apiKey,
      body: { confirmSiren: SCENARIO_SELLER.siren },
    });
    expect(deleted.status).toBe(200);
    for (const table of [docs, docLines, items]) {
      expect(await database.db.select().from(table).where(eq(table.tenantId, c.tenant.id))).toEqual(
        [],
      );
    }
    // The sweep does not bring it back.
    expect(await registryBehind(database.db)).not.toContain(c.tenant.id);
    expect(await c.refresh()).toEqual({ projected: 0, removed: 0 });
  });
});
