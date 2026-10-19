// The sync load test (R0, docs/PROGRESS.md): what one sheet costs the API. In this process, on PGlite
// in memory, or on the Postgres of --database-url: a throwaway one, it is migrated and filled. Never
// read from .env, which may name a database that matters.
//   1. first sync of a sheet at the row limit (one invoice per row);
//   2. the same sheet again: 0 INSERT/UPDATE/DELETE;
//   3. one cell changed: one invoice written;
//   4. the registry of ~50 000 lines (sheets of 800 invoices × 5 lines), projected in one refresh.
//   pnpm load:sync      pnpm load:sync --rows 1000 --registry-lines 5000 --database-url postgres://…
import { parseArgs } from 'node:util';
import { fakeAdapter, newTenant, refreshRegistry, testApi, testDatabase } from '@fi/api/testing';
import { detectMapping, type GridCell, grid } from '@fi/core';

const { values } = parseArgs({
  options: {
    rows: { type: 'string', default: '4999' },
    'registry-lines': { type: 'string', default: '50000' },
    'database-url': { type: 'string' },
  },
});
const ROWS = Number(values.rows);
const REGISTRY_LINES = Number(values['registry-lines']);
const LINES_PER_INVOICE = 5;
const REGISTRY_SHEET_ROWS = 4_000;

const queries: { query: string; params: unknown[] }[] = [];
let recording = false;
const database = await testDatabase({
  ...(values['database-url'] && { url: values['database-url'] }),
  logger: {
    logQuery: (query, params) => {
      if (recording) queries.push({ query, params });
    },
  },
});
const { request } = testApi(database, { mock: fakeAdapter() });

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
const DATE: GridCell = { v: 46310, t: '15/10/2026', f: 'dd/mm/yyyy' };
const RATE: GridCell = { v: 0.2, t: '20%', f: '0%' };
const row = (number: string, client: string, item: string, quantity: number): GridCell[] => [
  number,
  DATE,
  client,
  '200000008',
  '3 rue de la Gare',
  '21000',
  'Dijon',
  item,
  quantity,
  450,
  RATE,
];
const numbered = (n: number) => `F-${String(n).padStart(6, '0')}`;

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
  return t;
}

interface Measured {
  ms: number;
  writes: { what: string; params: unknown[] }[];
  rows: { invoiceId: string | null }[];
}

async function sync(
  apiKey: string,
  workbook: string,
  snapshot: ReturnType<typeof grid>,
): Promise<Measured> {
  const mapping = detectMapping(snapshot);
  queries.length = 0;
  recording = true;
  const started = performance.now();
  try {
    const res = await request(`/workbooks/${workbook}/sync`, {
      method: 'POST',
      token: apiKey,
      body: { snapshot, mapping },
    });
    if (res.status !== 200) throw new Error(`sync: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { rows: { invoiceId: string | null }[] };
    const ms = performance.now() - started;
    const writes = queries.flatMap(({ query, params }) => {
      const m = /^\s*(insert into|update|delete from)\s+"?(\w+)"?/i.exec(query);
      return m ? [{ what: `${m[1]?.split(' ')[0]?.toLowerCase()} ${m[2]}`, params }] : [];
    });
    return { ms, writes, rows: body.rows };
  } finally {
    recording = false;
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const report: string[] = [`database: ${database.kind}`];
const fail = (message: string) => {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
};

// 1–3: one sheet at the limit.
const seller = await company();
const rows = Array.from({ length: ROWS }, (_, i) =>
  row(numbered(i + 1), `Client ${i % 97}`, 'Journée de conseil', 1),
);
const first = await sync(seller.apiKey, 'wb-load-sync', grid('Factures', [HEADER, ...rows]));
report.push(
  `first sync, ${ROWS} rows: ${seconds(first.ms)}, ${first.rows.length} invoices, ${first.writes.length} writes`,
);

const again = await sync(seller.apiKey, 'wb-load-sync', grid('Factures', [HEADER, ...rows]));
report.push(`repeat sync: ${seconds(again.ms)}, ${again.writes.length} writes`);
if (again.writes.length !== 0) fail(`a repeat sync wrote: ${again.writes.map((w) => w.what)}`);

const at = Math.floor(ROWS / 2);
const edited = rows.map((r, i) =>
  i === at ? row(numbered(i + 1), `Client ${i % 97}`, 'Journée de conseil', 3) : r,
);
const edit = await sync(seller.apiKey, 'wb-load-sync', grid('Factures', [HEADER, ...edited]));
const ids = first.rows.flatMap((r) => (r.invoiceId ? [r.invoiceId] : []));
const touched = ids.filter((id) => edit.writes.some((w) => w.params.includes(id)));
report.push(
  `one cell changed: ${seconds(edit.ms)}, ${edit.writes.length} writes, ${touched.length} invoice written`,
);
if (touched.length !== 1) fail(`one cell changed ${touched.length} invoices`);

// 4: the registry of another company, filled by sheets, projected in one refresh.
const buyer = await company();
const invoicesPerSheet = REGISTRY_SHEET_ROWS / LINES_PER_INVOICE;
const sheets = Math.ceil(REGISTRY_LINES / REGISTRY_SHEET_ROWS);
let syncing = 0;
for (let s = 0; s < sheets; s++) {
  const lines: GridCell[][] = [];
  for (let i = 0; i < invoicesPerSheet; i++) {
    const number = numbered(s * invoicesPerSheet + i + 1);
    for (let l = 0; l < LINES_PER_INVOICE; l++)
      lines.push(
        row(number, `Client ${i % 97}`, `Article ${(i * LINES_PER_INVOICE + l) % 400}`, l + 1),
      );
  }
  syncing += (await sync(buyer.apiKey, `wb-registry-${s}`, grid('Ventes', [HEADER, ...lines]))).ms;
}
const started = performance.now();
const refreshed = await refreshRegistry(database.db, buyer.id, new Date());
const registryMs = performance.now() - started;
const total = sheets * REGISTRY_SHEET_ROWS;
report.push(
  `registry: ${total} lines in ${sheets} sheets (synced in ${seconds(syncing)}), ${refreshed.projected} invoices projected in ${seconds(registryMs)}`,
);
if (registryMs > 30_000) fail(`the registry took ${seconds(registryMs)} (target < 30 s)`);
const repeat = performance.now();
const nothing = await refreshRegistry(database.db, buyer.id, new Date());
report.push(
  `registry again: ${nothing.projected} projected in ${seconds(performance.now() - repeat)}`,
);

console.log(report.join('\n'));
await database.close();
