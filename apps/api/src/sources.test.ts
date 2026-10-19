// The workbook's other sheets (R1): a sheet the company includes feeds the registry; an edit rewrites
// only the document it touched, the same snapshot twice writes nothing, « Retirer » takes its
// documents out, and a confirmed layout is found again by its headers.
import { type GridCell, grid, type LayoutMapping } from '@fi/core';
import type { Database } from '@fi/db';
import { and, asc, auditEvents, docLines, docs, eq, items, layoutProfiles, sources } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_SELLER } from './scenarios/invoice';
import { fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';

let database: Database;
let request: ReturnType<typeof testApi>['request'];

beforeAll(async () => {
  database = await testDatabase();
  ({ request } = testApi(database, { mock: fakeAdapter() }));
});
afterAll(async () => {
  await database.close();
});

const d = (serial: number, text: string): GridCell => ({ v: serial, t: text, f: 'dd/mm/yyyy' });
const OCT1 = d(46296, '01/10/2026');
const OCT6 = d(46301, '06/10/2026');
const HEADER: GridCell[] = ['N° commande', 'Date', 'Client', 'Réf.', 'Désignation', 'Qté', 'PU HT'];
const ORDERS: GridCell[][] = [
  ['C-41', OCT1, 'Boulangerie Martin', 'TAB-01', 'Tabouret chêne', 4, 85],
  ['', '', '', 'ETA-12', 'Étagère murale', 1, 140],
  ['C-42', OCT6, 'Garage des Lilas', 'ETA-12', 'Étagère murale', 2, 140],
  ['C-43', OCT6, 'Cabinet Roux', 'BUR-03', 'Bureau compact', 1, 420],
];
const orders = (rows = ORDERS, title: GridCell[][] = []) =>
  grid('Commandes', [...title, HEADER, ...rows]);

interface Source {
  id: string;
  sheet: string;
  kind: string;
  readAt: string | null;
  changedAt: string | null;
  stats: {
    docs: number;
    lines: number;
    rows: number;
    ignoredRows: number;
    unreadRows: number;
    headerFound: boolean;
  };
}
interface Read {
  source: Source;
  written: number;
  removed: number;
}

async function company(workbook: string) {
  const t = await newTenant(request);
  const call = async (path: string, method: string, body?: unknown, status = 200) => {
    const res = await request(`/workbooks/${workbook}/sources${path}`, {
      method,
      token: t.apiKey,
      ...(body !== undefined && { body }),
    });
    expect(res.status, await res.clone().text()).toBe(status);
    return res.json();
  };
  const detect = (snapshot: ReturnType<typeof grid>) =>
    call('/detect', 'POST', { snapshot }) as Promise<{
      layout: LayoutMapping;
      profile: { id: string; version: number } | null;
      degraded: string | null;
      included: boolean;
    }>;
  const include = async (snapshot: ReturnType<typeof grid>, layout?: LayoutMapping) => {
    const proposed = layout ?? (await detect(snapshot)).layout;
    return call(`/${encodeURIComponent(snapshot.sheet)}`, 'PUT', {
      layout: proposed,
      snapshot,
    }) as Promise<Read>;
  };
  const sync = (snapshot: ReturnType<typeof grid>) =>
    call(`/${encodeURIComponent(snapshot.sheet)}/sync`, 'POST', { snapshot }) as Promise<Read>;
  const documents = () =>
    database.db.select().from(docs).where(eq(docs.tenantId, t.id)).orderBy(asc(docs.sourceKey));
  const lines = (docId: string) =>
    database.db
      .select({
        name: docLines.name,
        quantity: docLines.quantity,
        netAmount: docLines.netAmount,
        cell: docLines.cell,
        key: items.key,
      })
      .from(docLines)
      .leftJoin(items, eq(items.id, docLines.itemId))
      .where(eq(docLines.docId, docId))
      .orderBy(asc(docLines.position));
  const events = async (action: string) =>
    (
      await database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(and(eq(auditEvents.tenantId, t.id), eq(auditEvents.action, action)))
    ).length;
  return { tenant: t, call, detect, include, sync, documents, lines, events };
}

describe('including a sheet', () => {
  it('proposes what it holds, reads it into the registry once included, cell by cell', async () => {
    const c = await company('wb-sources-01');
    const proposal = await c.detect(orders());
    expect(proposal).toMatchObject({ profile: null, degraded: 'ai_off', included: false });
    expect(proposal.layout).toMatchObject({ kind: 'order', headerRow: 1, source: 'heuristic' });

    const read = await c.include(orders());
    expect(read).toMatchObject({ written: 3, removed: 0 });
    expect(read.source).toMatchObject({
      sheet: 'Commandes',
      kind: 'order',
      stats: { docs: 3, lines: 4, rows: 4, ignoredRows: 0, unreadRows: 0, headerFound: true },
    });
    const [first, second] = await c.documents();
    expect(first).toMatchObject({
      kind: 'order',
      direction: 'out',
      sourceKey: 'C-41',
      number: 'C-41',
      issueDate: '2026-10-01',
      partyName: 'Boulangerie Martin',
      isTest: false,
      netTotal: 48_000,
    });
    expect(second?.number).toBe('C-42');
    expect(await c.lines(first?.id ?? '')).toEqual([
      {
        name: 'Tabouret chêne',
        quantity: '4',
        netAmount: 34_000,
        cell: 'Commandes!E2',
        key: 'ref:TAB-01',
      },
      {
        name: 'Étagère murale',
        quantity: '1',
        netAmount: 14_000,
        cell: 'Commandes!E3',
        key: 'ref:ETA-12',
      },
    ]);
    expect(await c.events('source.include')).toBe(1);
    expect(await c.events('layout_profile.confirm')).toBe(1);
    expect(await c.events('source.read')).toBe(1);
    expect((await c.detect(orders())).included).toBe(true);
  });

  it('finds a confirmed layout again for the same headers, even lower in another sheet', async () => {
    const c = await company('wb-sources-02');
    const proposal = await c.detect(orders());
    // The company corrects the proposal: the price is not wanted, the date is.
    const { unitPrice: _, ...mapping } = proposal.layout.mapping;
    await c.include(orders(), { ...proposal.layout, mapping });

    const november = grid('Commandes novembre', [['Novembre 2026'], [], HEADER, ...ORDERS]);
    const again = await c.detect(november);
    expect(again.profile).toMatchObject({ version: 1 });
    expect(again.degraded).toBeNull();
    expect(again.layout).toMatchObject({ sheet: 'Commandes novembre', headerRow: 3 });
    expect(again.layout.source).toBe('profile');
    expect(again.layout.mapping.unitPrice).toBeUndefined();

    // Confirmed the same: no new version. Confirmed with a change: version 2.
    await c.include(november, again.layout);
    expect((await c.detect(november)).profile?.version).toBe(1);
    await c.include(november, { ...again.layout, mapping: proposal.layout.mapping });
    expect((await c.detect(november)).profile?.version).toBe(2);
    expect(await c.events('layout_profile.confirm')).toBe(2);
  });

  it('refuses an invoice sheet, a sheet it never included, and a sheet another company included', async () => {
    const c = await company('wb-sources-03');
    const proposal = await c.detect(orders());
    const refused = (await c.call(
      '/Commandes',
      'PUT',
      {
        layout: { ...proposal.layout, kind: 'invoice' },
        snapshot: orders(),
      },
      422,
    )) as { error: { code: string; message: string } };
    expect(refused.error.code).toBe('layout_kind_unsupported');
    expect(refused.error.message).toContain("Rien n'a été enregistré");
    await c.call('/Autre', 'PUT', { layout: proposal.layout, snapshot: orders() }, 400);
    const missing = (await c.call('/Commandes/sync', 'POST', { snapshot: orders() }, 404)) as {
      error: { code: string };
    };
    expect(missing.error.code).toBe('source_not_found');
    await c.call('/Commandes', 'DELETE', undefined, 404);

    await c.include(orders());
    const other = await company('wb-sources-03');
    await other.call('/Commandes/sync', 'POST', { snapshot: orders() }, 404);
    await other.call('/Commandes', 'DELETE', undefined, 404);
    expect(await other.documents()).toHaveLength(0);
  });
});

describe('an edit in an included sheet', () => {
  it('rewrites the one document it touched; the same snapshot again writes nothing', async () => {
    const c = await company('wb-sources-04');
    await c.include(orders());
    const before = await c.documents();

    // One cell: the quantity of order C-42.
    const edited = ORDERS.map((r) => [...r]);
    (edited[2] as GridCell[])[5] = 3;
    const read = await c.sync(orders(edited));
    expect(read).toMatchObject({ written: 1, removed: 0 });
    const after = await c.documents();
    const changed = after.filter(
      (a) => before.find((b) => b.id === a.id)?.updatedAt.getTime() !== a.updatedAt.getTime(),
    );
    expect(changed.map((x) => x.number)).toEqual(['C-42']);
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
    expect((await c.lines(changed[0]?.id ?? ''))[0]).toMatchObject({ quantity: '3' });

    // The pane sends the same sheet again (another cell of another sheet changed): zero writes.
    const reads = await c.events('source.read');
    const same = await c.sync(orders(edited));
    expect(same).toMatchObject({ written: 0, removed: 0 });
    expect(same.source.readAt).toBe(read.source.readAt);
    expect(await c.events('source.read')).toBe(reads);
    expect((await c.documents()).map((x) => x.updatedAt.getTime())).toEqual(
      after.map((x) => x.updatedAt.getTime()),
    );

    // An order deleted from the sheet leaves the registry; rows moved up only move cells.
    const fewer = await c.sync(orders(edited.slice(0, 3)));
    expect(fewer).toMatchObject({ written: 0, removed: 1 });
    const moved = await c.sync(orders(edited.slice(0, 3), [['Carnet de commandes']]));
    expect(moved).toMatchObject({ written: 2, removed: 0, source: { stats: { docs: 2 } } });
    const [first] = await c.documents();
    expect((await c.lines(first?.id ?? ''))[0]?.cell).toBe('Commandes!E3');
    // Headers renamed: read as before, and the sheet's card says so.
    const renamed = grid('Commandes', [
      ['Commande', 'Le', 'Pour', 'Code', 'Article', 'Nombre', 'Prix'],
      ...edited.slice(0, 3),
    ]);
    expect((await c.sync(renamed)).source.stats.headerFound).toBe(false);
  });

  it('reads every document again under another kind', async () => {
    const c = await company('wb-sources-05');
    const proposal = await c.detect(orders());
    await c.include(orders());
    const read = await c.include(orders(), { ...proposal.layout, kind: 'delivery' });
    expect(read).toMatchObject({ written: 3, removed: 0, source: { kind: 'delivery' } });
    expect(new Set((await c.documents()).map((x) => x.kind))).toEqual(new Set(['delivery']));
  });
});

describe('purchases and price lists', () => {
  it("files a purchase as bought, under the supplier's article, and a price list as one document", async () => {
    const c = await company('wb-sources-06');
    const purchases = grid('Achats', [
      ['N° cde', 'Date', 'Fournisseur', 'SIRET', 'Réf. frs', 'Article', 'Qté', 'PA HT'],
      ['A-1', OCT1, 'Bois du Morvan', '41234567800017', 'CH-27', 'Chêne 27 mm', 12, 18.5],
      ['A-2', OCT6, 'Quincaillerie Roux', '', 'VS-4', 'Vis 4×40', 500, 0.07],
    ]);
    const bought = await c.include(purchases);
    expect(bought.source.kind).toBe('purchase');
    const prices = grid('Tarifs', [
      ['Réf.', 'Désignation', 'Unité', 'Prix HT', 'TVA'],
      ['TAB-01', 'Tabouret chêne', 'pièce', 85, 20],
      ['MENUISERIE', '', '', '', ''],
      ['ETA-12', 'Étagère murale', 'pièce', 140, 20],
    ]);
    const priced = await c.include(prices);
    expect(priced.source.stats).toMatchObject({ docs: 1, lines: 2, ignoredRows: 1 });

    const all = await c.documents();
    const a1 = all.find((x) => x.number === 'A-1');
    expect(a1).toMatchObject({ kind: 'purchase', direction: 'in', partySiren: '412345678' });
    expect((await c.lines(a1?.id ?? ''))[0]?.key).toBe('supplier:siren:412345678:ref:CH-27');
    const a2 = all.find((x) => x.number === 'A-2');
    expect((await c.lines(a2?.id ?? ''))[0]?.key).toBe('supplier:name:quincaillerie roux:ref:VS-4');
    const list = all.find((x) => x.kind === 'price_list');
    expect(list).toMatchObject({ direction: 'out', sourceKey: 'sheet', number: null });
    expect((await c.lines(list?.id ?? '')).map((l) => [l.key, l.netAmount])).toEqual([
      ['ref:TAB-01', 8_500],
      ['ref:ETA-12', 14_000],
    ]);
  });
});

describe('the « Registre » screen and « Retirer »', () => {
  it('shows each included sheet and its latest documents; « Retirer » takes them out', async () => {
    const c = await company('wb-sources-07');
    await c.include(orders());
    const listed = (await c.call('', 'GET')) as { sources: Source[] };
    expect(listed.sources.map((s) => s.sheet)).toEqual(['Commandes']);

    const res = await request('/registry', { token: c.tenant.apiKey });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      sources: Source[];
      invoices: { sent: number; received: number };
      recent: { number: string | null; sheet: string | null; kind: string; cell: string | null }[];
    };
    expect(view.sources).toHaveLength(1);
    expect(view.invoices).toEqual({ sent: 0, received: 0 });
    expect(view.recent.map((r) => r.sheet)).toEqual(['Commandes', 'Commandes', 'Commandes']);
    expect(view.recent.map((r) => r.cell).sort()).toEqual([
      'Commandes!E2',
      'Commandes!E4',
      'Commandes!E5',
    ]);

    expect(await c.call('/Commandes', 'DELETE')).toEqual({ removed: true, sheet: 'Commandes' });
    expect(await c.documents()).toHaveLength(0);
    expect(await c.events('source.remove')).toBe(1);
    expect(((await c.call('', 'GET')) as { sources: Source[] }).sources).toEqual([]);
  });
});

describe('RGPD', () => {
  it('exports the included sheets and their layouts, and deletes them with the account', async () => {
    const c = await company('wb-sources-08');
    await c.include(orders());
    const res = await request('/tenant/export', { token: c.tenant.apiKey });
    const exported = (await res.json()) as {
      layoutProfiles: { kind: string; version: number }[];
      includedSheets: { sheet: string; kind: string; consentedAt: string }[];
      registry: { documents: { kind: string; sheet: string | null; sheetKey: string | null }[] };
    };
    expect(exported.layoutProfiles).toMatchObject([{ kind: 'order', version: 1 }]);
    expect(exported.includedSheets).toMatchObject([{ sheet: 'Commandes', kind: 'order' }]);
    expect(exported.registry.documents).toContainEqual(
      expect.objectContaining({ kind: 'order', sheet: 'Commandes', sheetKey: 'C-41' }),
    );

    const deleted = await request('/tenant', {
      method: 'DELETE',
      token: c.tenant.apiKey,
      body: { confirmSiren: SCENARIO_SELLER.siren },
    });
    expect(deleted.status).toBe(200);
    for (const table of [sources, layoutProfiles, docs, items]) {
      expect(await database.db.select().from(table).where(eq(table.tenantId, c.tenant.id))).toEqual(
        [],
      );
    }
  });
});
