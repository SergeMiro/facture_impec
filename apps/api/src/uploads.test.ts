// Files uploaded from the pane (R6): a workbook whose sheets are included like a picked file's, a
// supplier invoice in Factur-X, UBL or CII read as bought (the B2 acceptance is in purchases.test.ts),
// and every file the pane cannot take refused calmly, nothing kept.
import { FILE_LIMITS, toCii, toUbl } from '@fi/core';
import { type XlsxCell, xlsxOf } from '@fi/core/testing/xlsx';
import type { Database } from '@fi/db';
import { docs, eq, sources, uploads } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkNow } from './checks';
import {
  companies,
  invoiceRow,
  invoiceSheet,
  orders,
  SEP1,
  supplierDocument,
} from './checks.fixtures';
import { registryBehind } from './registry';
import { SCENARIO_SELLER } from './scenarios/invoice';
import { fakeAdapter, type RecordedJobs, testApi, testDatabase } from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;
let jobs: RecordedJobs;
const clock = new Date('2026-10-20T08:00:00Z');

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => clock });
  ({ jobs } = api);
});
afterAll(async () => {
  await database.close();
});

const company = (workbook: string) => companies({ request: api.request, database })(workbook);

const ORDER_HEADER: XlsxCell[] = ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'];
const ordersFile = (price: number) =>
  xlsxOf({
    Commandes: [
      ORDER_HEADER,
      ['C-118', { date: 46266 }, 'Durand SARL', 'Chaise pliante', 10, price],
    ],
    Notes: [['Rien à lire ici']],
  });
const text = (value: string) => new TextEncoder().encode(value);

interface Upload {
  id: string;
  name: string;
  format: string;
  kind: string;
  sheets: { sheet: string; present: boolean; source: { kind: string } | null }[];
  invoice: { number: string | null; supplier: string | null; received: boolean } | null;
}
type Added = { upload: Upload; replaced: boolean };

/** A minimal PDF with no Factur-X data: a page, nothing attached. */
const PLAIN_PDF = text(
  [
    '%PDF-1.4',
    '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
    '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
    '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]>> endobj',
    'trailer <</Root 1 0 R>>',
    '%%EOF',
  ].join('\n'),
);

describe('an uploaded workbook', () => {
  it('has its sheets included like a picked file, and is read again when replaced', async () => {
    const c = await company('wb-upload-01');
    const added = (await c.call('/uploads?name=Commandes.xlsx', 'POST', ordersFile(30))) as Added;
    expect(added).toMatchObject({
      replaced: false,
      upload: {
        name: 'Commandes.xlsx',
        format: 'xlsx',
        kind: 'workbook',
        invoice: null,
        sheets: [
          { sheet: 'Commandes', present: true, source: null },
          { sheet: 'Notes', present: true, source: null },
        ],
      },
    });
    const id = added.upload.id;
    const base = `/uploads/${id}/sheets/Commandes`;
    const { layout } = (await c.call(`${base}/detect`, 'POST')) as { layout: { kind: string } };
    expect(layout.kind).toBe('order');
    await c.call(base, 'PUT', { layout });
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-501', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    expect((await c.checks()).findings).toEqual([]);
    // « Registre » names the file the sheet comes from.
    const registry = (await c.call('/registry')) as { sources: { sheet: string; file: string }[] };
    expect(registry.sources).toEqual([
      expect.objectContaining({ type: 'upload', sheet: 'Commandes', file: 'Commandes.xlsx' }),
    ]);

    // The same name again, with the order at 40 €: the included sheet is read again.
    const queued = jobs.registry.length;
    const replaced = (await c.call(
      '/uploads?name=Commandes.xlsx',
      'POST',
      ordersFile(40),
    )) as Added;
    expect(replaced).toMatchObject({
      replaced: true,
      upload: {
        id,
        sheets: [{ sheet: 'Commandes', source: { kind: 'order' } }, { sheet: 'Notes' }],
      },
    });
    expect(jobs.registry.slice(queued)).toContain(c.id);
    await checkNow(database.db, c.id, clock);
    const [b1] = (await c.checks()).findings;
    expect(b1).toMatchObject({ rule: 'B1', amount: 10_000 });
    expect(b1?.evidence.find((e) => e.role === 'order')).toMatchObject({
      file: 'Commandes.xlsx',
    });

    // The same bytes again change nothing.
    const same = (await c.call('/uploads?name=Commandes.xlsx', 'POST', ordersFile(40))) as Added;
    expect(same.replaced).toBe(false);
    expect(await c.audits('upload.add')).toHaveLength(1);
    expect(await c.audits('upload.replace')).toHaveLength(1);

    // Its sheet is read from the file only: a snapshot from a pane under its id is refused.
    const snapshot = orders(['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, 99]);
    await c.call(`/workbooks/${id}/sources/Commandes`, 'PUT', { layout, snapshot }, 404);
    await c.call(`/workbooks/${id}/sources/Commandes/sync`, 'POST', { snapshot }, 404);
  });

  it('reads a CSV file, and « Retirer » deletes the file and what it gave', async () => {
    const c = await company('wb-upload-02');
    const csv = text(
      'N° commande;Date;Client;Désignation;Qté;PU HT\nC-118;01/09/2026;Durand SARL;Chaise pliante;10;40\n',
    );
    const { upload } = (await c.call('/uploads?name=Commandes.csv', 'POST', csv)) as Added;
    expect(upload).toMatchObject({ format: 'csv', kind: 'workbook' });
    const [sheet] = upload.sheets;
    if (!sheet) throw new Error('no sheet');
    const base = `/uploads/${upload.id}/sheets/${encodeURIComponent(sheet.sheet)}`;
    const { layout } = (await c.call(`${base}/detect`, 'POST')) as { layout: { kind: string } };
    expect(layout.kind).toBe('order');
    await c.call(base, 'PUT', { layout });
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-502', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    expect((await c.checks()).findings).toMatchObject([{ rule: 'B1', amount: 10_000 }]);

    // One sheet out, then the file.
    await c.call(base, 'DELETE');
    expect(await database.db.select().from(sources).where(eq(sources.tenantId, c.id))).toEqual([]);
    await c.call(base, 'PUT', { layout });
    expect(await c.call(`/uploads/${upload.id}`, 'DELETE')).toEqual({ uploads: [] });
    const left = await database.db.select().from(docs).where(eq(docs.tenantId, c.id));
    expect(left.filter((d) => d.sourceId !== null)).toEqual([]);
    await checkNow(database.db, c.id, clock);
    expect((await c.checks()).findings).toEqual([]);
    expect(await c.audits('upload.remove')).toHaveLength(1);
    // Gone: its routes say so.
    await c.call(`/uploads/${upload.id}`, 'DELETE', undefined, 404);
    await c.call(`${base}/detect`, 'POST', undefined, 404);
  });
});

describe('an uploaded supplier invoice', () => {
  it('is read from UBL or CII, and is replaced under its own name only', async () => {
    const c = await company('wb-upload-03');
    const ubl = (await c.call(
      '/uploads?name=FA-601.xml',
      'POST',
      text(toUbl(supplierDocument('FA-601', '35.00'))),
    )) as Added;
    expect(ubl.upload).toMatchObject({
      format: 'ubl',
      kind: 'invoice',
      invoice: { number: 'FA-601', supplier: 'Grossiste Martin SAS', received: false },
    });
    const cii = (await c.call(
      '/uploads?name=FA-602.xml',
      'POST',
      text(toCii(supplierDocument('FA-602', '35.00'))),
    )) as Added;
    expect(cii.upload.format).toBe('cii');
    // Not projected yet: the sweep finds the company behind.
    expect(await registryBehind(database.db)).toContain(c.id);
    await checkNow(database.db, c.id, clock);
    expect(await registryBehind(database.db)).not.toContain(c.id);
    const bought = await database.db.select().from(docs).where(eq(docs.tenantId, c.id));
    expect(bought.map((d) => d.number).sort()).toEqual(['FA-601', 'FA-602']);
    expect(bought.every((d) => d.direction === 'in' && d.uploadId !== null)).toBe(true);

    // The same invoice under another name is refused; under its own name, it replaces.
    const twin = await api.request('/uploads?name=copie.xml', {
      method: 'POST',
      token: c.apiKey,
      body: text(toUbl(supplierDocument('FA-601', '35.00'))),
    });
    expect(twin.status).toBe(409);
    expect(((await twin.json()) as { error: { message: string } }).error.message).toBe(
      "La facture FA-601 de ce fournisseur est déjà importée (fichier « FA-601.xml »). Rien n'a été ajouté. Pour la remplacer, importez-la sous le même nom de fichier.",
    );
    const again = (await c.call(
      '/uploads?name=FA-601.xml',
      'POST',
      text(toUbl(supplierDocument('FA-601', '36.00'))),
    )) as Added;
    expect(again.replaced).toBe(true);
    await checkNow(database.db, c.id, clock);
    const lines = await database.db.select().from(docs).where(eq(docs.tenantId, c.id));
    expect(lines.find((d) => d.number === 'FA-601')?.netTotal).toBe(36_000);
  });
});

describe('a file the pane cannot take', () => {
  const refused = async (
    c: Awaited<ReturnType<typeof company>>,
    name: string,
    body: Uint8Array,
    status: number,
    code: string,
  ) => {
    const res = await api.request(`/uploads?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      token: c.apiKey,
      body,
    });
    expect(res.status, await res.clone().text()).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  };

  it('is refused with what happened, and nothing is kept', async () => {
    const c = await company('wb-upload-04');
    await refused(c, 'scan.pdf', PLAIN_PDF, 422, 'upload_plain_pdf');
    await refused(
      c,
      'photo.png',
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      415,
      'upload_unsupported',
    );
    await refused(c, 'vide.csv', new Uint8Array(), 422, 'upload_unreadable');
    await refused(c, 'casse.xlsx', text('PK pas un zip'), 422, 'upload_unreadable');
    await refused(
      c,
      'autre.xml',
      text('<html><body>Bonjour</body></html>'),
      422,
      'upload_unreadable',
    );
    const big = new Uint8Array(FILE_LIMITS.maxBytes + 1);
    big.set(text('PK'));
    await refused(c, 'gros.xlsx', big, 413, 'upload_too_large');
    // Not a purchase of the company: its own invoice, or one addressed to another buyer.
    const own = supplierDocument('F-2026-700', '35.00', {
      seller: SCENARIO_SELLER.siren,
      buyer: '200000008',
    });
    await refused(c, 'mienne.xml', text(toCii(own)), 422, 'upload_own_invoice');
    const other = supplierDocument('FA-701', '35.00', { buyer: '200000008' });
    await refused(c, 'autre-client.xml', text(toCii(other)), 422, 'upload_other_buyer');
    // A name it cannot show.
    await refused(c, ' ', text('a;b\n1;2\n'), 400, 'invalid_request');
    expect(await database.db.select().from(uploads).where(eq(uploads.tenantId, c.id))).toEqual([]);
    expect(await c.audits('upload.add')).toEqual([]);
  });

  it('is not reached from another company', async () => {
    const a = await company('wb-upload-05');
    const b = await company('wb-upload-06');
    const { upload } = (await a.call(
      '/uploads?name=Commandes.xlsx',
      'POST',
      ordersFile(30),
    )) as Added;
    await b.call(`/uploads/${upload.id}`, 'DELETE', undefined, 404);
    await b.call(`/uploads/${upload.id}/sheets/Commandes/detect`, 'POST', undefined, 404);
    expect(await b.call('/uploads')).toEqual({ uploads: [] });
  });
});

describe('RGPD', () => {
  it('exports the files without their content, and erases them with the account', async () => {
    const c = await company('wb-upload-07');
    await c.call('/uploads?name=Commandes.xlsx', 'POST', ordersFile(30));
    await c.call(
      '/uploads?name=FA-801.xml',
      'POST',
      text(toCii(supplierDocument('FA-801', '35.00'))),
    );
    const data = (await c.call('/tenant/export')) as { uploads: Record<string, unknown>[] };
    expect(data.uploads).toEqual([
      expect.objectContaining({
        name: 'Commandes.xlsx',
        format: 'xlsx',
        sheets: ['Commandes', 'Notes'],
      }),
      expect.objectContaining({ name: 'FA-801.xml', format: 'cii', number: 'FA-801' }),
    ]);
    expect(data.uploads.every((u) => !('content' in u) && !('parsed' in u))).toBe(true);
    const tenant = (await c.call('/tenant')) as { siren: string };
    await c.call('/tenant', 'DELETE', { confirmSiren: tenant.siren });
    expect(await database.db.select().from(uploads).where(eq(uploads.tenantId, c.id))).toEqual([]);
  });
});
