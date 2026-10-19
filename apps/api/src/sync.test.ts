// What a sync writes (R0): nothing when the sheet did not change, one invoice when one cell did, and
// invoices that keep their rows when rows move, are removed or are renumbered. Every query is counted
// through the database logger.
import { detectMapping, type GridCell, grid } from '@fi/core';
import type { Database } from '@fi/db';
import { and, applyTransition, eq, invoiceEvents, invoices } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';
import type { SyncResult } from './workbooks';

let database: Database;
let request: ReturnType<typeof testApi>['request'];
let clock = new Date('2026-10-19T09:30:00Z');
const queries: { query: string; params: unknown[] }[] = [];
let recording = false;

beforeAll(async () => {
  database = await testDatabase({
    logger: {
      logQuery: (query, params) => {
        if (recording) queries.push({ query, params });
      },
    },
  });
  ({ request } = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => clock }));
});
afterAll(async () => {
  await database.close();
});

interface Write {
  /** `update invoices`, `insert validation_results`… */
  what: string;
  params: unknown[];
}

/** The writes `run` sends to the database. */
async function writes<T>(run: () => Promise<T>): Promise<{ result: T; writes: Write[] }> {
  queries.length = 0;
  recording = true;
  try {
    const result = await run();
    const found = queries.flatMap(({ query, params }) => {
      const m = /^\s*(insert into|update|delete from)\s+"?(\w+)"?/i.exec(query);
      return m ? [{ what: `${m[1]?.split(' ')[0]?.toLowerCase()} ${m[2]}`, params }] : [];
    });
    return { result, writes: found };
  } finally {
    recording = false;
  }
}
const what = (list: Write[]) => list.map((w) => w.what).sort();

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
const line = (number: string | null, client: string, quantity = 1): GridCell[] => [
  number,
  { v: 46310, t: '15/10/2026', f: 'dd/mm/yyyy' },
  client,
  '200000008',
  '3 rue de la Gare',
  '21000',
  'Dijon',
  'Journée de conseil',
  quantity,
  450,
  { v: 0.2, t: '20%', f: '0%' },
];
const sheet = (...rows: GridCell[][]) => grid('Factures', [HEADER, ...rows]);

async function tenant() {
  const t = await newTenant(request, {
    vatId: 'FR88100000009',
    address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
  });
  const res = await request('/settings', {
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
  expect(res.status).toBe(200);
  return t;
}

let workbooks = 0;

/** A tenant and one workbook of its own, synced with the sheet the test passes. */
async function workbook() {
  const t = await tenant();
  const id = `wb-sync-${++workbooks}`;
  const sync = async (snapshot: ReturnType<typeof sheet>, grouped = true) => {
    const detected = detectMapping(snapshot);
    const mapping = grouped ? detected : { ...detected, grouping: null };
    const res = await request(`/workbooks/${id}/sync`, {
      method: 'POST',
      token: t.apiKey,
      body: { snapshot, mapping },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResult;
  };
  return { tenant: t, sync };
}

const ids = (result: SyncResult) => result.rows.map((r) => r.invoiceId);

describe('a sync writes what changed, nothing more', () => {
  it('writes nothing when the sheet did not change', async () => {
    const { sync } = await workbook();
    const rows = [line('F-1', 'Martin'), line('F-2', 'Dupont'), line(null, 'Dupont', 2)];
    const first = await sync(sheet(...rows));
    expect(first.rows.map((r) => [r.rows, r.status])).toEqual([
      [[2], 'validated'],
      [[3, 4], 'validated'],
    ]);
    const again = await writes(() => sync(sheet(...rows)));
    expect(what(again.writes)).toEqual([]);
    expect(again.result.rows).toEqual(first.rows);
  });

  it('writes and checks only the invoice whose cell changed', async () => {
    const { sync } = await workbook();
    const first = await sync(sheet(line('F-1', 'Martin'), line('F-2', 'Dupont')));
    const [martin, dupont] = ids(first);
    const edited = await writes(() => sync(sheet(line('F-1', 'Martin'), line('F-2', 'Dupont', 3))));
    expect(ids(edited.result)).toEqual([martin, dupont]);
    // The edit (and its audit event), the new verdict (its event, its audit event, its key).
    expect(what(edited.writes)).toEqual([
      'insert audit_events',
      'insert audit_events',
      'insert invoice_events',
      'insert validation_results',
      'update invoices',
      'update invoices',
      'update invoices',
    ]);
    expect(edited.writes.every((w) => w.params.includes(dupont))).toBe(true);
    expect(edited.writes.some((w) => w.params.includes(martin))).toBe(false);
  });

  it('checks again, without a new verdict, when only the day changed', async () => {
    const { sync } = await workbook();
    const rows = [line('F-1', 'Martin'), line('F-2', 'Dupont')];
    await sync(sheet(...rows));
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    const nextDay = await writes(() => sync(sheet(...rows)));
    // One statement remembers both checks; the verdicts did not change.
    expect(what(nextDay.writes)).toEqual(['update invoices']);
    expect(what((await writes(() => sync(sheet(...rows)))).writes)).toEqual([]);
  });
});

describe('rows that move keep their invoice', () => {
  it('follows an invoice without a number when rows are inserted above it', async () => {
    const { sync } = await workbook();
    // One invoice per row: a row without a number is an invoice of its own, keyed by its row.
    const first = await sync(sheet(line('F-1', 'Martin'), line(null, 'Durand')), false);
    expect(first.rows.map((r) => r.rowKey)).toEqual(['F-1', 'row:3']);
    const [martin, durand] = ids(first);
    const moved = await sync(
      sheet(
        line('F-1', 'Martin'),
        line('F-3', 'Petit'),
        line(null, 'Bernard'),
        line(null, 'Durand'),
      ),
      false,
    );
    expect(moved.rows.map((r) => r.rowKey)).toEqual(['F-1', 'F-3', 'row:4', 'row:5']);
    const [m, petit, bernard, d] = ids(moved);
    expect([m, d]).toEqual([martin, durand]);
    expect(new Set([petit, bernard, martin, durand]).size).toBe(4);
  });

  it('keeps the invoice of a row whose number was changed in place', async () => {
    const { sync } = await workbook();
    const first = await sync(sheet(line('F-1', 'Martin'), line('F-2', 'Dupont')));
    const renumbered = await sync(sheet(line('F-1', 'Martin'), line('F-20', 'Dupont')));
    expect(ids(renumbered)).toEqual(ids(first));
    expect(renumbered.rows[1]?.number).toBe('F-20');
  });

  it('cancels the invoice of a removed row, unless it already left', async () => {
    const { sync } = await workbook();
    const first = await sync(
      sheet(line('F-1', 'Martin'), line('F-2', 'Dupont'), line('F-3', 'Durand')),
    );
    const [martin, dupont, durand] = ids(first) as [string, string, string];
    // F-3 is on its way to the platform: the sheet no longer decides for it.
    await database.db.transaction((tx) =>
      applyTransition(tx, { invoiceId: durand, event: 'approve', actor: 'user' }),
    );
    const after = await sync(sheet(line('F-1', 'Martin')));
    expect(ids(after)).toEqual([martin]);
    const status = async (id: string) =>
      (await database.db.select().from(invoices).where(eq(invoices.id, id)))[0]?.status;
    expect(await status(dupont)).toBe('cancelled');
    expect(await status(durand)).toBe('ready_to_send');
    const [cancel] = await database.db
      .select()
      .from(invoiceEvents)
      .where(and(eq(invoiceEvents.invoiceId, dupont), eq(invoiceEvents.event, 'cancel')));
    expect(cancel).toMatchObject({ actor: 'user', payload: { reason: 'row_removed' } });
  });
});
