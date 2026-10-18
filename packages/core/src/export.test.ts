import { describe, expect, it } from 'vitest';
import { checkFec, checkFecName, readCsv } from '../test/export-check';
import { computeGolden, golden } from '../test/fixtures';
import {
  buildCsv,
  buildFec,
  FEC_FIELDS,
  fecAmount,
  fecReady,
  type PurchaseItem,
  purchaseItem,
  supplierAccount,
} from './export';

const BUYER_SIREN = '200000008';
const item = (name: string, pdpRef = `ref-${name}`): PurchaseItem =>
  purchaseItem(computeGolden(golden(name)), { pdpRef, receivedAt: '2026-10-17T22:30:00Z' });

describe('accountant export: FEC purchase journal', () => {
  it('writes amounts with a decimal comma and no thousands separator', () => {
    expect(fecAmount(0)).toBe('0,00');
    expect(fecAmount(5)).toBe('0,05');
    expect(fecAmount(123456789)).toBe('1234567,89');
    expect(fecAmount(-1250)).toBe('-12,50');
  });

  it('passes every rule of article A47 A-1, one balanced entry per invoice, numbers continuing', () => {
    const items = [item('02-goods-two-rates'), item('01-services-standard-rate')];
    const fec = buildFec(items, { siren: BUYER_SIREN, firstEntry: 41, validDate: '2026-10-18' });
    expect(fec.name).toBe('200000008FEC20261018');
    expect(checkFecName(`${fec.name}.txt`)).toEqual([]);
    const { problems, lines } = checkFec(fec.text);
    expect(problems).toEqual([]);
    expect(fec.text.split('\r\n')[0]).toBe(FEC_FIELDS.join('\t'));
    expect(fec.text.endsWith('\r\n')).toBe(true);
    expect(fec).toMatchObject({ entries: 2, lastEntry: 42 });
    // Sorted by date then number: F2026-0042 is entry 41, F2026-0043 (two VAT rates) entry 42.
    expect(lines.filter((l) => l.EcritureNum === '41').map((l) => l.CompteNum)).toEqual([
      '606000',
      '445660',
      '401000',
    ]);
    const two = lines.filter((l) => l.EcritureNum === '42');
    expect(two.map((l) => l.CompteNum)).toEqual(['606000', '445660', '606000', '445660', '401000']);
    const supplier = two.at(-1);
    expect(supplier).toMatchObject({
      JournalCode: 'ACH',
      JournalLib: 'Achats',
      EcritureDate: '20261015',
      CompteLib: 'Fournisseurs',
      CompAuxNum: 'F100000009',
      CompAuxLib: 'Atelier Dupont SARL',
      PieceRef: 'F2026-0043',
      PieceDate: '20261015',
      EcritureLib: 'Atelier Dupont SARL F2026-0043',
      Debit: '0,00',
      Credit: fecAmount(items[0]?.taxInclusive ?? 0),
      ValidDate: '20261018',
      Montantdevise: '',
      Idevise: '',
    });
  });

  it('books a credit note on the other side', () => {
    const credit = item('10-credit-note');
    const { problems, lines } = checkFec(
      buildFec([credit], { siren: BUYER_SIREN, firstEntry: 1, validDate: '2026-10-18' }).text,
    );
    expect(problems).toEqual([]);
    expect(lines.at(-1)).toMatchObject({
      CompteNum: '401000',
      Debit: fecAmount(credit.taxInclusive),
    });
    expect(lines[0]).toMatchObject({ CompteNum: '606000', Debit: '0,00' });
  });

  it('keeps out what it cannot book: another currency, VAT lines that do not add up', () => {
    const ok = item('01-services-standard-rate');
    expect(fecReady(ok)).toBe(true);
    expect(fecReady({ ...ok, currency: 'USD' })).toBe(false);
    expect(fecReady({ ...ok, taxInclusive: ok.taxInclusive + 1 })).toBe(false);
    expect(fecReady({ ...ok, vat: [] })).toBe(false);
    expect(() =>
      buildFec([{ ...ok, currency: 'USD' }], {
        siren: BUYER_SIREN,
        firstEntry: 1,
        validDate: '2026-10-18',
      }),
    ).toThrow(/cannot go into the FEC/);
  });

  it('never lets a supplier name break a line or a field', () => {
    const ok = item('01-services-standard-rate');
    const odd = { ...ok, supplier: { name: 'Tab\tPipe|Line\r\nBreak' } };
    const { problems, lines } = checkFec(
      buildFec([odd], { siren: BUYER_SIREN, firstEntry: 1, validDate: '2026-10-18' }).text,
    );
    expect(problems).toEqual([]);
    expect(lines.at(-1)?.CompAuxLib).toBe('Tab Pipe Line Break');
    expect(supplierAccount({ name: 'Élan & Fils' })).toBe('FELANFILS');
    expect(supplierAccount({ name: 'x', vatId: 'de 123' })).toBe('FDE123');
  });
});

describe('the FEC checker', () => {
  const good = buildFec([item('01-services-standard-rate')], {
    siren: BUYER_SIREN,
    firstEntry: 1,
    validDate: '2026-10-18',
  }).text;
  const edit = (from: string, to: string) => good.replace(from, to);

  it('catches what the article forbids', () => {
    const problems = (text: string) => checkFec(text).problems.join('\n');
    expect(problems(good.replaceAll('\t', ';'))).toMatch(/separator/);
    expect(problems(`﻿${good}`)).toMatch(/BOM/);
    expect(problems(edit('JournalLib', 'JournalLabel'))).toMatch(/header/);
    expect(problems(edit('\t20261015\t', '\t2026-10-15\t'))).toMatch(/EcritureDate/);
    expect(problems(good.replaceAll('20261015', '20261315'))).toMatch(/not AAAAMMJJ/);
    expect(problems(good.replace(/\t(\d+),(\d\d)\t0,00\t/, '\t$1.$2\t0,00\t'))).toMatch(
      /not a number/,
    );
    expect(problems(edit('\t606000\t', '\tA06000\t'))).toMatch(/CompteNum/);
    expect(problems(edit('\tAchats\t', '\t\t'))).toMatch(/JournalLib is empty/);
    expect(
      problems(good.replace(/\t0,00\t(\d+,\d\d)\t\t\t20261018/, '\t0,00\t1,00\t\t\t20261018')),
    ).toMatch(/debit .* credit/);
    expect(problems(good.replace(/\r\n[^\r\n]+\r\n$/, '\r\nACH\tAchats\r\n'))).toMatch(
      /fields instead/,
    );
    expect(checkFecName('200000008FEC2026101.txt')).toHaveLength(1);
    expect(checkFecName('200000008FEC20261341')).toHaveLength(1);
    expect(checkFecName('TEST-200000008FEC20261018.txt')).toEqual([]);
  });

  it('reads « montant » and « sens » files and catches a broken sequence', () => {
    const sens = [
      [...FEC_FIELDS.slice(0, 11), 'Montant', 'Sens', ...FEC_FIELDS.slice(13)].join('|'),
      'ACH|Achats|1|20261015|606000|Achats|||F1|20261015|x|100,00|D|||20261018||',
      'ACH|Achats|1|20261015|401000|Fournisseurs|F1|Dupont|F1|20261015|x|100,00|-1|||20261018||',
      'ACH|Achats|3|20261015|606000|Achats|||F2|20261015|x|5,00|+1|||20261018||',
      'ACH|Achats|3|20261015|401000|Fournisseurs|||F2|20261015|x|5,00|C|||20261018||',
    ].join('\n');
    expect(checkFec(sens).problems).toEqual(['entry 3: follows 1, the sequence is broken']);
    expect(checkFec(sens.replace('|D|', '|+ 1|')).problems.join()).toMatch(/Sens/);
  });
});

describe('accountant export: CSV', () => {
  it('opens as a French spreadsheet reads it: BOM, « ; », CRLF, decimal comma, credit notes negative', () => {
    const items = [item('02-goods-two-rates'), item('10-credit-note')];
    const csv = buildCsv(items);
    expect(csv.startsWith('﻿')).toBe(true);
    const { problems, rows } = readCsv(csv);
    expect(problems).toEqual([]);
    expect(rows[0]).toEqual([
      'Fournisseur',
      'SIREN fournisseur',
      'N° TVA fournisseur',
      'Type',
      'Numéro',
      'Date',
      'Échéance',
      'Total HT',
      'TVA',
      'Total TTC',
      'Net à payer',
      'Devise',
      'IBAN',
      'Reçue le',
      'Référence plateforme',
    ]);
    expect(rows[1]).toEqual([
      'Atelier Dupont SARL',
      '100000009',
      'FR88100000009',
      'Facture',
      'F2026-0043',
      '15/10/2026',
      '14/11/2026',
      fecAmount(items[0]?.taxExclusive ?? 0),
      fecAmount(items[0]?.taxTotal ?? 0),
      fecAmount(items[0]?.taxInclusive ?? 0),
      fecAmount(items[0]?.payable ?? 0),
      'EUR',
      'FR7630006000011234567890189',
      // 22:30 UTC on the 17th is the 18th in Paris.
      '18/10/2026',
      'ref-02-goods-two-rates',
    ]);
    expect(rows[2]?.[3]).toBe('Avoir');
    expect(rows[2]?.[9]).toBe(fecAmount(-(items[1]?.taxInclusive ?? 0)));
  });

  it('quotes what needs it and never lets a spreadsheet run a formula from a supplier file', () => {
    const ok = item('01-services-standard-rate');
    const csv = buildCsv([{ ...ok, supplier: { name: '=HYPERLINK("x";"y")' }, number: 'A;B' }]);
    const { problems, rows } = readCsv(csv);
    expect(problems).toEqual([]);
    expect(rows[1]?.[0]).toBe('\'=HYPERLINK("x";"y")');
    expect(rows[1]?.[4]).toBe('A;B');
    expect(readCsv('a;b\r\n1').problems.join()).toMatch(/CRLF/);
    expect(readCsv('a;b\r\n1\r\n').problems.join()).toMatch(/1 cells instead of 2/);
    expect(readCsv('a;"b\r\n').problems.join()).toMatch(/unterminated/);
    expect(readCsv('a\nb\r\n').problems.join()).toMatch(/bare line break/);
  });
});
