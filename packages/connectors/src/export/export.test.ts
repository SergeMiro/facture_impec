// The export connector (D9) on files written as Batigest and EBP lists would be: the labels are
// common French usage, made up here, not a pilot's real export (TODO(verify), docs/TODO.md).
import { luhn } from '@fi/core';
import { xlsxOf } from '@fi/core/testing/xlsx';
import { FatalError } from '@fi/domain';
import { describe, expect, it } from 'vitest';
import type { Cursor, ErpBatch } from '../types';
import { guessList } from './columns';
import { type ExportConfig, type ExportRow, exportConnector } from './connector';
import { readExport } from './read';

/** A SIREN with its check digit, from any eight digits. */
function sirenOf(n: number): string {
  const body = String(20_000_000 + n);
  for (let d = 0; d < 10; d++) if (luhn(`${body}${d}`)) return `${body}${d}`;
  throw new Error('no check digit');
}
/** The SIRET of a SIREN's first establishment. */
function siretOf(siren: string): string {
  for (let d = 0; d < 10; d++) if (luhn(`${siren}0001${d}`)) return `${siren}0001${d}`;
  throw new Error('no check digit');
}

const csv = (lines: string[], name = 'export.csv') => ({
  name,
  bytes: new Uint8Array(Buffer.from(lines.join('\r\n'), 'utf8')) as Uint8Array<ArrayBuffer>,
});

async function pullAll(cfg: ExportConfig, cursor: Cursor | null = null) {
  const batches: ErpBatch<ExportRow>[] = [];
  for await (const b of exportConnector.pull(cfg, cursor)) batches.push(b);
  return batches;
}

const fatal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(e).toBeInstanceOf(FatalError);
  return e as FatalError;
};

describe('the lists an ERP exports', () => {
  const dupont = sirenOf(1);
  const martin = sirenOf(2);

  it('find the labels below a title, guess the list, and read each row', async () => {
    const file = csv([
      'Liste des clients;;;;;;',
      'Édité le 24/10/2026;;;;;;',
      'Code client;Raison sociale;SIRET;E-mail;Adresse;CP;Ville',
      `C001;SARL Dupont Bâtiment;${siretOf(dupont)};Compta@Dupont.test;3 rue des Lilas;1000;Bourg-en-Bresse`,
      `C002;Martin & Fils;${martin};pas-une-adresse;;;`,
      'C003;Mme Durand;;durand@example.test;;;',
      'C004;Erreur SARL;123456789;;;;',
      ';;;;;;',
      'Total;4 clients;;;;;',
    ]);
    const sheet = await readExport(file);
    expect(sheet).toMatchObject({ list: 'customers', headerRow: 3 });
    expect(sheet.columns).toMatchObject({ code: 'A', name: 'B', siret: 'C', email: 'D' });
    const [batch] = await pullAll({ file, sha256: 'a'.repeat(64) });
    expect(batch?.entity).toBe('tiers');
    expect(batch?.rows).toEqual([
      {
        ok: true,
        value: {
          row: 4,
          code: 'C001',
          name: 'SARL Dupont Bâtiment',
          siren: dupont,
          siret: siretOf(dupont),
          email: 'compta@dupont.test',
          // The zero Excel drops from a postcode typed as a number comes back.
          address: { line1: '3 rue des Lilas', postCode: '01000', city: 'Bourg-en-Bresse' },
        },
      },
      // An e-mail that is none is left out; the company is kept.
      { ok: true, value: { row: 5, code: 'C002', name: 'Martin & Fils', siren: martin } },
      { ok: false, skipped: { row: 6, name: 'Mme Durand', reason: 'no_siren' } },
      { ok: false, skipped: { row: 7, name: 'Erreur SARL', reason: 'siren_invalid' } },
    ]);
    expect(batch?.nextCursor).toEqual({ sha256: 'a'.repeat(64), row: 7, list: 'customers' });
  });

  it('read the suppliers a sous-traitant flag or family marks', async () => {
    const file = csv([
      'Code fournisseur;Nom;SIREN;Sous-traitant;Famille',
      `F01;Plâtrerie Roux;${sirenOf(3)};Oui;Second œuvre`,
      `F02;Négoce Matériaux;${sirenOf(4)};Non;Négoce`,
      `F03;Électricité Bleue;${sirenOf(5)};;Sous-traitants`,
      `F04;Plâtrerie Roux (doublon);${sirenOf(3)};;`,
    ]);
    const [batch] = await pullAll({ file, sha256: 'b'.repeat(64) });
    const rows = batch?.rows ?? [];
    expect(
      rows.map((r) =>
        r.ok && 'siren' in r.value ? r.value.subcontracting : !r.ok && r.skipped.reason,
      ),
    ).toEqual([true, false, true, 'duplicate']);
    expect((await readExport(file)).list).toBe('suppliers');
  });

  it('read chantiers from a workbook: dates, status, retenue, the customer', async () => {
    const file = {
      name: 'chantiers.xlsx',
      bytes: xlsxOf({
        Chantiers: [
          [
            'N° chantier',
            'Libellé',
            'Code client',
            'Client',
            'Ville',
            'État',
            'Date de réception',
            'RG %',
          ],
          ['CH-01', 'Les Tilleuls', 'C001', 'SARL Dupont Bâtiment', 'Dijon', 'En cours', null, 5],
          [
            'CH-02',
            'École Jules Ferry',
            null,
            'Mairie de Talant',
            'Talant',
            'Terminé',
            { date: 46_000 },
            '5 %',
          ],
          ['CH-03', 'Garage Martin', 'C002', null, null, null, '12/03/2026', 12],
          [null, 'Sans code', null, null, null, null, null, null],
        ],
      }),
    };
    const sheet = await readExport(file);
    expect(sheet.list).toBe('chantiers');
    const [batch] = await pullAll({ file, sha256: 'c'.repeat(64) });
    expect(batch?.entity).toBe('chantier');
    expect(batch?.rows).toEqual([
      {
        ok: true,
        value: {
          row: 2,
          code: 'CH-01',
          name: 'Les Tilleuls',
          customer: { code: 'C001', name: 'SARL Dupont Bâtiment' },
          address: { city: 'Dijon' },
          status: 'open',
          retenueBps: 500,
        },
      },
      {
        ok: true,
        value: {
          row: 3,
          code: 'CH-02',
          name: 'École Jules Ferry',
          customer: { name: 'Mairie de Talant' },
          address: { city: 'Talant' },
          status: 'closed',
          receptionOn: '2025-12-09',
          retenueBps: 500,
        },
      },
      // 12 % is no retenue de garantie (5 % at most): left out, the chantier kept.
      {
        ok: true,
        value: {
          row: 4,
          code: 'CH-03',
          name: 'Garage Martin',
          customer: { code: 'C002' },
          receptionOn: '2026-03-12',
        },
      },
      { ok: false, skipped: { row: 5, name: 'Sans code', reason: 'no_code' } },
    ]);
  });

  it('read an invoice list: what is owed, by when, to whom, and skip what is not owed', async () => {
    const file = csv([
      'N° facture;Type;Date;Échéance;Code client;Client;Chantier;Montant TTC;Reste à payer;N° situation',
      'F2026-101;Facture;02/10/2026;01/11/2026;C001;Dupont;CH-01;1 200,00 €;1 200,00;',
      'S2026-07;Situation de travaux;05/10/2026;04/11/2026;;Mairie de Talant;Les Tilleuls;9 500,00;3 000,00;4',
      'F2026-102;Facture;06/10/2026;05/11/2026;C001;Dupont;;480,00;0,00;',
      'F2026-103;Facture;07/10/2026;;C001;Dupont;;100,00;100,00;',
      'AV2026-01;Avoir;08/10/2026;08/10/2026;C001;Dupont;;-120,00;-120,00;',
      'D2026-12;Devis;09/10/2026;09/11/2026;C002;Martin;;5 000,00;5 000,00;',
      ';Facture;10/10/2026;10/11/2026;C002;Martin;;10,00;10,00;',
      'F2026-104;Facture;11/10/2026;11/11/2026;C002;Martin;;;;',
      'F2026-101;Facture;02/10/2026;01/11/2026;C001;Dupont;CH-01;1 200,00;1 200,00;',
      'Total;;;;;;;;4 300,00;',
    ]);
    const sheet = await readExport(file);
    expect(sheet.list).toBe('invoices');
    expect(sheet.columns).toMatchObject({
      number: 'A',
      type: 'B',
      issuedOn: 'C',
      dueOn: 'D',
      customerCode: 'E',
      customerName: 'F',
      chantierName: 'G',
      total: 'H',
      left: 'I',
      situation: 'J',
    });
    const [batch] = await pullAll({ file, sha256: 'a'.repeat(64) });
    expect(batch?.entity).toBe('facture');
    const rows = batch?.rows ?? [];
    expect(rows.slice(0, 3)).toEqual([
      {
        ok: true,
        value: {
          row: 2,
          number: 'F2026-101',
          kind: 'facture',
          issuedOn: '2026-10-02',
          dueOn: '2026-11-01',
          customer: { code: 'C001', name: 'Dupont' },
          chantier: { name: 'CH-01' },
          total: 120_000,
          left: 120_000,
        },
      },
      {
        ok: true,
        value: {
          row: 3,
          number: 'S2026-07',
          kind: 'situation',
          issuedOn: '2026-10-05',
          dueOn: '2026-11-04',
          customer: { name: 'Mairie de Talant' },
          chantier: { name: 'Les Tilleuls' },
          total: 950_000,
          left: 300_000,
        },
      },
      // Paid: it is read, and the API closes its deadline or counts it.
      expect.objectContaining({ ok: true, value: expect.objectContaining({ left: 0 }) }),
    ]);
    expect(rows.slice(3).map((r) => (r.ok ? 'ok' : [r.skipped.row, r.skipped.reason]))).toEqual([
      [5, 'no_due_date'],
      [6, 'credit_note'],
      [7, 'not_invoice'],
      [8, 'no_number'],
      [9, 'no_amount'],
      [10, 'duplicate'],
    ]);
  });

  it('read a payment list: the invoice it pays and how much', async () => {
    const file = csv([
      'Date règlement;N° facture;Client;Mode de règlement;Montant;Référence',
      '15/10/2026;F2026-101;Dupont;Virement;1 200,00;VIR-881',
      '16/10/2026;S2026-07;Mairie de Talant;Chèque;1 500,00;',
      '16/10/2026;S2026-07;Mairie de Talant;Chèque;1 500,00;',
      '17/10/2026;;Martin;Virement;50,00;',
      '18/10/2026;F2026-104;Martin;Remboursement;-50,00;',
    ]);
    const sheet = await readExport(file);
    expect(sheet.list).toBe('payments');
    const [batch] = await pullAll({ file, sha256: 'b'.repeat(64) });
    expect(batch?.entity).toBe('reglement');
    expect(batch?.rows).toEqual([
      {
        ok: true,
        value: {
          row: 2,
          invoice: 'F2026-101',
          paidOn: '2026-10-15',
          amount: 120_000,
          mode: 'Virement',
          reference: 'VIR-881',
        },
      },
      {
        ok: true,
        value: {
          row: 3,
          invoice: 'S2026-07',
          paidOn: '2026-10-16',
          amount: 150_000,
          mode: 'Chèque',
        },
      },
      // The same invoice, day and amount without a reference: the same payment, listed twice.
      { ok: false, skipped: { row: 4, name: 'S2026-07', reason: 'duplicate' } },
      { ok: false, skipped: { row: 5, name: 'Martin', reason: 'no_number' } },
      { ok: false, skipped: { row: 6, name: 'F2026-104', reason: 'credit_note' } },
    ]);
    // An invoice list without a due date says so.
    const noDue = csv(['N° facture;Client;Montant TTC;Reste à payer', 'F1;Dupont;10,00;10,00']);
    expect((await fatal(readExport(noDue))).message).toBe('invoices:dueOn');
  });

  it('say what stops an import, and import nothing', async () => {
    // No SIREN nor SIRET: a company cannot be known.
    const noSiren = csv(['Code client;Raison sociale;Ville', 'C1;Dupont;Dijon']);
    expect((await fatal(readExport(noSiren))).message).toBe('customers:siren|siret');
    expect((await fatal(readExport(noSiren))).code).toBe('export_column_missing');
    // Labels that name neither side: the person says which list it is.
    const unknown = csv(['Code;Raison sociale;SIREN', `X;Dupont;${dupont}`]);
    expect((await fatal(readExport(unknown))).code).toBe('export_list_unknown');
    expect((await readExport(unknown, 'suppliers')).list).toBe('suppliers');
    // No row of labels at all.
    expect((await fatal(readExport(csv(['a;b;c', '1;2;3'])))).code).toBe('export_no_header');
    // Not a workbook.
    const pdf = { name: 'clients.pdf', bytes: new Uint8Array([37, 80, 68, 70]) };
    expect((await fatal(readExport(pdf as never))).code).toBe('export_unsupported');
    const broken = { name: 'clients.xlsx', bytes: new Uint8Array([1, 2, 3]) };
    expect((await fatal(readExport(broken as never))).code).toBe('export_unreadable');
    expect(await exportConnector.probe({ file: noSiren, sha256: 'd'.repeat(64) })).toEqual({
      ok: false,
      detail: 'export_column_missing',
    });
  });

  it('pull 500 rows at a time and resume where the cursor stopped', async () => {
    const lines = ['Code client;Raison sociale;SIREN'];
    for (let n = 1; n <= 1_201; n++) lines.push(`C${n};Client ${n};${sirenOf(100 + n)}`);
    const file = csv(lines);
    const cfg = { file, sha256: 'e'.repeat(64), list: 'customers' as const };
    const all = await pullAll(cfg);
    expect(all.map((b) => [b.rows.length, b.nextCursor.row])).toEqual([
      [500, 501],
      [500, 1_001],
      [201, 1_202],
    ]);
    // Stopped after the first batch: the rest, and only the rest.
    const resumed = await pullAll(cfg, all[0]?.nextCursor ?? null);
    expect(resumed.map((b) => b.rows.length)).toEqual([500, 201]);
    // The cursor of another file starts this one at the top.
    const other = await pullAll(cfg, { sha256: 'f'.repeat(64), row: 1_001 });
    expect(other.map((b) => b.rows.length)).toEqual([500, 500, 201]);
    expect(await exportConnector.probe(cfg)).toEqual({ ok: true, detail: 'customers: 1201' });
  });

  it('guess a list from its labels only when they tell', () => {
    expect(guessList(['Code affaire', 'Libellé'])).toBe('chantiers');
    expect(guessList(['N° client', 'Nom'])).toBe('customers');
    expect(guessList(['Fournisseur', 'SIRET'])).toBe('suppliers');
    expect(guessList(['Client', 'Fournisseur'])).toBeUndefined();
    // An invoice list may name its chantier, its payment mode and what was paid.
    expect(
      guessList(['N° facture', 'Chantier', 'Mode de règlement', 'Échéance', 'Montant TTC']),
    ).toBe('invoices');
    expect(guessList(['N° facture', 'Date de règlement', 'Montant'])).toBe('payments');
    // Payment terms on a list of customers do not make it invoices.
    expect(guessList(['Code client', 'Nom', 'Mode de règlement', 'Échéance'])).toBe('customers');
  });
});
