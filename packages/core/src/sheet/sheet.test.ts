import { describe, expect, it } from 'vitest';
import { computeInvoice } from '../compute';
import { validate } from '../rules';
import { cellForPath, readSheet, type SheetInvoice } from './build';
import { cellAddress, columnIndex, columnLetters, isBlank, parseAddress } from './cells';
import { detectMapping, headerScore, normalizeHeader } from './detect';
import { CORE_FIELDS, type SellerProfile, SheetMapping } from './fields';
import { grid } from './grid';
import {
  dateFromText,
  dateOf,
  decimalFromText,
  decimalOf,
  identifierOf,
  natureOf,
  numberText,
  rateOf,
  serialToIso,
  textOf,
} from './values';

const SELLER: SellerProfile = {
  name: 'Atelier Dupont SARL',
  siren: '100000009',
  vatId: 'FR88100000009',
  address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
  defaults: {
    siret: '10000000900017',
    iban: 'FR7630006000011234567890189',
    paymentDays: 30,
    operationCategory: 'services',
  },
};

const ctx = { today: '2026-10-18' };
const one = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('missing');
  return value;
};
const lines = (invoice: SheetInvoice | undefined) => one(invoice).draft.lines ?? [];
const errors = (draft: Parameters<typeof computeInvoice>[0]) =>
  validate(computeInvoice(draft), ctx).filter((i) => i.severity === 'error');

const cell = (value: string | number, text = String(value), format?: string) => ({
  col: 'A',
  value,
  text,
  ...(format && { format }),
});

describe('cells', () => {
  it('converts column letters both ways', () => {
    for (const n of [1, 2, 26, 27, 52, 702, 703, 16384])
      expect(columnIndex(columnLetters(n))).toBe(n);
    expect(columnLetters(28)).toBe('AB');
  });

  it('writes and reads addresses, quoting sheet names that need it', () => {
    expect(cellAddress('Feuil1', 'C', 14)).toBe('Feuil1!C14');
    expect(cellAddress('Factures 2026', 'C', 14)).toBe("'Factures 2026'!C14");
    expect(cellAddress("L'atelier", 'A', 1)).toBe("'L''atelier'!A1");
    expect(cellAddress('A1', 'B', 2)).toBe("'A1'!B2");
    for (const a of ['Feuil1!C14', "'Factures 2026'!C14", "'L''atelier'!A1"]) {
      const p = parseAddress(a);
      expect(
        p && cellAddress(p.sheet, p.cell.replace(/\d+/, ''), Number(p.cell.replace(/\D+/, ''))),
      ).toBe(a);
    }
    expect(parseAddress('C14')).toBeNull();
  });

  it('treats empty strings and null as blank', () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank({ col: 'A', value: null, text: '' })).toBe(true);
    expect(isBlank({ col: 'A', value: '  ', text: '' })).toBe(true);
    expect(isBlank({ col: 'A', value: 0, text: '0' })).toBe(false);
  });
});

describe('values', () => {
  it('reads French and English numbers, and only unambiguous ones', () => {
    expect(decimalFromText('1 234,50 €')).toBe('1234.50');
    expect(decimalFromText('1 234,5')).toBe('1234.5');
    expect(decimalFromText('1.234,50')).toBe('1234.50');
    expect(decimalFromText('1,234.50')).toBe('1234.50');
    expect(decimalFromText('450 € HT')).toBe('450');
    expect(decimalFromText('+12')).toBe('12');
    expect(decimalFromText('-3,5')).toBe('-3.5');
    expect(decimalFromText('12,')).toBe('12');
    expect(decimalFromText('douze')).toBeUndefined();
    expect(decimalFromText('1,2,3')).toBeUndefined();
  });

  it('removes the binary noise of Excel floats', () => {
    expect(numberText(20.009999999999998)).toBe('20.01');
    expect(numberText(0.1 + 0.2)).toBe('0.3');
    expect(numberText(1e21)).toBeUndefined();
    expect(numberText(Number.NaN)).toBeUndefined();
    expect(decimalOf(cell(19.99))).toBe('19.99');
    expect(decimalOf(cell('1 234,50', '1 234,50'))).toBe('1234.50');
    expect(decimalOf(cell('beaucoup'))).toBe('beaucoup');
    expect(decimalOf(undefined)).toBeUndefined();
  });

  it('reads VAT rates from percent cells, fractions and text', () => {
    expect(rateOf(cell(0.2, '20%', '0%'))).toBe('20');
    expect(rateOf(cell(0.055, '5,5 %', '0.0%'))).toBe('5.5');
    expect(rateOf(cell(0.1, '0.1'))).toBe('10');
    expect(rateOf(cell(20))).toBe('20');
    expect(rateOf(cell(0.3, '0.3'))).toBe('0.3');
    expect(rateOf(cell('5,5 %'))).toBe('5.5');
    expect(rateOf(cell('vingt'))).toBe('vingt');
    expect(rateOf(undefined)).toBeUndefined();
  });

  it('reads dates from Excel serials and French text', () => {
    expect(serialToIso(46313)).toBe('2026-10-18');
    expect(serialToIso(46313.75)).toBe('2026-10-18');
    expect(serialToIso(10)).toBeUndefined();
    expect(dateOf(cell(46313, '18/10/2026', 'dd/mm/yyyy'))).toBe('2026-10-18');
    expect(dateOf(cell(46313, '46313', '0.00'))).toBe('46313');
    expect(dateFromText('18/10/2026')).toBe('2026-10-18');
    expect(dateFromText('18-10-26')).toBe('2026-10-18');
    expect(dateFromText('8.1.2027')).toBe('2027-01-08');
    expect(dateFromText('2026-10-18T00:00:00')).toBe('2026-10-18');
    expect(dateFromText('18 octobre 2026')).toBe('2026-10-18');
    expect(dateFromText('1er oct. 2026')).toBe('2026-10-01');
    expect(dateFromText('31/02/2026')).toBeUndefined();
    expect(dateFromText('2026-02-31')).toBeUndefined();
    expect(dateFromText('32 octobre 2026')).toBeUndefined();
    expect(dateFromText('demain')).toBeUndefined();
    expect(dateOf(cell('demain'))).toBe('demain');
    expect(dateOf(undefined)).toBeUndefined();
  });

  it('cleans identifiers and reads goods or services', () => {
    expect(identifierOf(cell('123 456 789'))).toBe('123456789');
    expect(identifierOf(cell('fr 37.200000008'))).toBe('FR37200000008');
    expect(identifierOf(cell(200000008))).toBe('200000008');
    expect(identifierOf(undefined)).toBeUndefined();
    expect(natureOf(cell('Prestation'))).toBe('services');
    expect(natureOf(cell('Biens'))).toBe('goods');
    expect(natureOf(cell('autre'))).toBeUndefined();
    expect(natureOf(undefined)).toBeUndefined();
    expect(textOf({ col: 'A', value: 12, text: '' })).toBe('12');
    expect(textOf({ col: 'A', value: null, text: '' })).toBeUndefined();
  });
});

// A sheet the way a TPE keeps it: a title, a blank row, then headers in row 3.
const simple = grid('Factures', [
  ['Mes factures 2026'],
  [],
  ['N° Facture', 'Date', 'Client', 'SIREN', 'Désignation', 'Qté', 'P.U. HT', 'TVA', 'Total TTC'],
  [
    'F2026-0042',
    { v: 46310, t: '15/10/2026', f: 'dd/mm/yyyy' },
    'Boulangerie Martin SAS',
    '200 000 008',
    'Journée de conseil',
    3,
    450,
    { v: 0.2, t: '20%', f: '0%' },
    1620,
  ],
  [
    'F2026-0043',
    '16/10/2026',
    'Boulangerie Martin SAS',
    '200000008',
    'Formation',
    1,
    '1 200,00',
    '20 %',
    1440,
  ],
]);

describe('detectMapping (dictionary)', () => {
  it('normalizes headers', () => {
    expect(normalizeHeader('N° Facture')).toBe('n facture');
    expect(normalizeHeader('  P.U. HT ')).toBe('p u ht');
    expect(normalizeHeader('Qté')).toBe('qte');
    expect(headerScore('Date', 'issueDate')).toBe(0.95);
    expect(headerScore('Date de la facture émise', 'issueDate')).toBe(0.85);
    expect(headerScore('Prix remisé', 'unitPrice')).toBe(0.65);
    expect(headerScore('', 'number')).toBe(0);
  });

  it('finds the header row below a title and maps the columns', () => {
    const m = detectMapping(simple);
    expect(m.headerRow).toBe(3);
    expect(Object.fromEntries(Object.entries(m.mapping).map(([f, v]) => [f, v?.column]))).toEqual({
      number: 'A',
      issueDate: 'B',
      buyerName: 'C',
      buyerSiren: 'D',
      itemName: 'E',
      quantity: 'F',
      unitPrice: 'G',
      vatRate: 'H',
      totalInclVat: 'I',
    });
    expect(m.grouping).toBeNull();
    expect(m.warnings).toEqual([]);
    expect(m.source).toBe('heuristic');
    expect(SheetMapping.parse(m)).toEqual(m);
  });

  it('asks for confirmation on vague headers and lists missing core fields', () => {
    const m = detectMapping(
      grid('S', [
        ['Facture', 'Montant', 'Remarque'],
        ['A1', 100, 'x'],
      ]),
    );
    expect(m.mapping.number).toMatchObject({ column: 'A', needsConfirmation: false });
    expect(m.mapping.lineNet).toMatchObject({ column: 'B', confidence: 0.95 });
    expect(m.warnings.join(' ')).toContain('Date de la facture');
    expect(m.warnings.join(' ')).not.toContain('Prix unitaire');
    const weak = detectMapping(
      grid('S', [
        ['Facture', 'Date émise', 'Prix remisé'],
        ['A', 1, 2],
      ]),
    );
    expect(weak.mapping.unitPrice).toMatchObject({ confidence: 0.65, needsConfirmation: true });
  });

  it('keeps a VAT amount column away from the rate, and splits SIREN/SIRET by length', () => {
    const m = detectMapping(
      grid('S', [
        ['Facture', 'Client', 'SIREN/SIRET', 'TVA'],
        ['A', 'X', '20000000800012', 123.45],
        ['B', 'Y', '20000000800012', 87.1],
      ]),
    );
    expect(m.mapping.vatRate).toBeUndefined();
    expect(m.mapping.buyerSiret).toMatchObject({ column: 'C', confidence: 0.9 });
    expect(m.mapping.buyerSiren).toBeUndefined();
  });

  it('never maps a SIREN column from the numbers alone', () => {
    const m = detectMapping(
      grid('S', [
        ['Facture', 'Client', 'Code'],
        ['A', 'X', '200000008'],
        ['B', 'Y', '100000009'],
      ]),
    );
    expect(m.mapping.buyerSiren).toBeUndefined();
  });

  it('groups multi-line invoices: repeated numbers, or blanks under merged cells', () => {
    const repeated = grid('S', [
      ['N° facture', 'Désignation', 'Prix'],
      ['F1', 'a', 1],
      ['F1', 'b', 2],
    ]);
    expect(detectMapping(repeated).grouping).toEqual({ by: 'A' });
    const merged = grid('S', [
      ['N° facture', 'Désignation', 'Prix'],
      ['F1', 'a', 1],
      [null, 'b', 2],
      ['Total', null, 3],
    ]);
    expect(detectMapping(merged).grouping).toEqual({ by: 'A' });
    const totalOnly = grid('S', [
      ['N° facture', 'Désignation', 'Prix'],
      ['F1', 'a', 1],
      [null, 'Total', 1],
    ]);
    expect(detectMapping(totalOnly).grouping).toBeNull();
    expect(
      detectMapping(
        grid('S', [
          ['Désignation', 'Prix'],
          ['a', 1],
        ]),
      ).grouping,
    ).toBeNull();
  });

  it('falls back to the first row when no row looks like headers', () => {
    expect(
      detectMapping(
        grid('S', [
          ['x', 'y'],
          ['1', '2'],
        ]),
      ).headerRow,
    ).toBe(1);
    expect(detectMapping({ sheet: 'Vide', rows: [] }).headerRow).toBe(1);
  });
});

describe('readSheet', () => {
  it('builds valid drafts from a simple sheet, with the cell behind each field', () => {
    const { invoices, ignoredRows } = readSheet(simple, detectMapping(simple), SELLER);
    expect(ignoredRows).toEqual([]);
    expect(invoices.map((i) => i.rowKey)).toEqual(['F2026-0042', 'F2026-0043']);
    const [first, second] = invoices;
    expect(first?.draft).toMatchObject({
      number: 'F2026-0042',
      issueDate: '2026-10-15',
      dueDate: '2026-11-14',
      processType: 'S1',
      buyer: {
        name: 'Boulangerie Martin SAS',
        legalId: { id: '200000008', scheme: '0002' },
        electronicAddress: { id: '200000008', scheme: '0225' },
      },
      lines: [
        {
          quantity: '3',
          price: { net: '450' },
          vat: { category: 'S', rate: '20' },
          nature: 'services',
        },
      ],
    });
    expect(lines(second)[0]?.price.net).toBe('1200.00');
    expect(first?.cells).toMatchObject({
      number: 'Factures!A4',
      'buyer.legalId.id': 'Factures!D4',
      'lines[0].vat.rate': 'Factures!H4',
    });
    expect(first?.problems).toEqual([]);
    // Everything else comes from the tenant: the only blocking gap is the address the sheet lacks.
    expect(errors(one(first).draft).map((i) => i.ruleId)).toEqual(['BR-10']);
  });

  it('points a missing value at its empty cell, so the fix lands where it belongs', () => {
    const blank = grid('Factures', [
      ['N° Facture', 'Date', 'Client', 'SIREN', 'Désignation', 'Qté', 'P.U. HT', 'TVA'],
      ['F2026-0050', '15/10/2026', 'Boulangerie Martin SAS', null, 'Conseil', 1, null, '20 %'],
    ]);
    const [invoice] = readSheet(blank, detectMapping(blank), SELLER).invoices;
    expect(invoice?.draft.buyer?.legalId).toBeUndefined();
    expect(one(invoice).cells['buyer.legalId.id']).toBe('Factures!D2');
    expect(cellForPath(one(invoice).cells, 'lines[0].price.net')).toBe('Factures!G2');
  });

  it('builds a draft with no blocking issue when the sheet has every column', () => {
    const full = grid('Feuil1', [
      [
        'N° facture',
        'Date',
        'Échéance',
        'Client',
        'SIREN',
        'N° TVA',
        'Adresse',
        'CP',
        'Ville',
        'Désignation',
        'Qté',
        'Unité',
        'PU HT',
        'Taux TVA',
        'Date de prestation',
      ],
      [
        'F2026-0042',
        '15/10/2026',
        '14/11/2026',
        'Boulangerie Martin SAS',
        '200000008',
        'FR37200000008',
        '3 place du Marché',
        21200,
        'Beaune',
        'Journée de conseil',
        3,
        'jours',
        450,
        20,
        '10/10/2026',
      ],
    ]);
    const mapping = detectMapping(full);
    expect(mapping.warnings).toEqual([]);
    const [invoice] = readSheet(full, mapping, SELLER).invoices;
    expect(lines(invoice)[0]?.unitCode).toBe('DAY');
    expect(invoice?.draft.buyer.address).toEqual({
      line1: '3 place du Marché',
      postCode: '21200',
      city: 'Beaune',
      country: 'FR',
    });
    expect(errors(one(invoice).draft)).toEqual([]);
  });

  it('points each issue at its cell', () => {
    const wrong = grid('Feuil1', [
      ['N° facture', 'Date', 'Client', 'SIREN', 'Désignation', 'Qté', 'PU HT', 'Taux TVA'],
      ['F1', '15/10/2026', 'Boulangerie Martin SAS', '200000009', 'Conseil', 1, 100, 21],
    ]);
    const [invoice] = readSheet(wrong, detectMapping(wrong), SELLER).invoices;
    const issues = validate(computeInvoice(one(invoice).draft), ctx);
    const siren = issues.find((i) => i.path.startsWith('buyer.legalId'));
    const rate = issues.find((i) => i.path === 'lines[0].vat.rate');
    expect(siren && cellForPath(invoice?.cells ?? {}, siren.path)).toBe('Feuil1!D2');
    expect(rate && cellForPath(invoice?.cells ?? {}, rate.path)).toBe('Feuil1!H2');
  });

  it('groups lines under merged cells, skips total rows and flags contradictions', () => {
    const sheet = grid('S', [
      ['N° facture', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT', 'Montant HT', 'TVA', 'TTC'],
      ['F1', '15/10/2026', 'Martin', 'Conseil', 2, 100, 200, 0.2, 360],
      [null, null, null, 'Déplacement', 1, 50, 60, 0.2, 360],
      ['F1', '15/10/2026', 'Dupuis', 'Repas', 1, 10, null, 0.1, 360],
      ['Total', null, null, null, null, null, 300, null, null],
      ['F2', '16/10/2026', 'Leroy', 'Atelier', 1, 99, 99, 0.2, 118.8],
    ]);
    const { invoices, ignoredRows } = readSheet(sheet, detectMapping(sheet), SELLER);
    expect(ignoredRows).toEqual([5]);
    expect(invoices.map((i) => [i.rowKey, i.rows])).toEqual([
      ['F1', [2, 3, 4]],
      ['F2', [6]],
    ]);
    const f1 = invoices[0];
    expect(lines(f1)).toHaveLength(3);
    expect(f1?.draft.buyer.name).toBe('Martin');
    expect(f1?.problems.map((p) => [p.code, p.cell])).toEqual([
      ['group_conflict', 'S!C4'],
      ['line_total_mismatch', 'S!G3'],
      ['total_mismatch', 'S!I2'],
    ]);
    expect(f1?.problems[1]?.messageFr).toContain('60,00');
    expect(invoices[1]?.problems).toEqual([]);
  });

  it('reads one row per invoice without grouping, and keeps duplicate numbers apart', () => {
    const sheet = grid('S', [
      ['Client', 'Désignation', 'Montant HT', 'Taux TVA', 'N° facture'],
      ['A', 'x', 100, 20, 'F1'],
      ['B', 'y', 100, 20, 'F1'],
      ['C', 'z', 100, 20, null],
    ]);
    const mapping = { ...detectMapping(sheet), grouping: null };
    const { invoices } = readSheet(sheet, mapping, SELLER);
    expect(invoices.map((i) => i.rowKey)).toEqual(['F1', 'F1@3', 'row:4']);
    // No quantity and no unit price: the line is one unit at the amount HT, and the price links there.
    expect(lines(invoices[0])[0]).toMatchObject({ quantity: '1', price: { net: '100' } });
    expect(invoices[0]?.cells['lines[0].price.net']).toBe('S!C2');
  });

  it('derives the unit price from the amount HT and the quantity', () => {
    const sheet = grid('S', [
      ['N° facture', 'Désignation', 'Qté', 'Montant HT', 'Taux TVA'],
      ['F1', 'x', 3, 100, 20],
      ['F2', 'y', 0, 100, 20],
      ['F3', 'z', 'trois', 100, 20],
    ]);
    const { invoices } = readSheet(sheet, detectMapping(sheet), SELLER);
    expect(invoices.map((i) => lines(i)[0]?.price.net)).toEqual(['33.3333', '100', '100']);
  });

  it('takes the SIREN from a SIRET, the due date from the payment delay, and nothing it cannot know', () => {
    const sheet = grid('S', [
      ['N° facture', 'Date', 'SIRET', 'Désignation', 'PU HT', 'Taux TVA', 'Pays', 'E-mail'],
      ['F1', 'pas de date', '20000000800012', 'x', 10, 0, 'France', 'compta@martin.fr'],
    ]);
    const bare: SellerProfile = { name: 'X', siren: '100000009', defaults: {} };
    const [invoice] = readSheet(sheet, detectMapping(sheet), bare).invoices;
    expect(invoice?.draft).toMatchObject({
      issueDate: 'pas de date',
      buyer: {
        legalId: { id: '200000008' },
        ids: [{ id: '20000000800012', scheme: '0009' }],
        address: { country: 'FR' },
        contact: { email: 'compta@martin.fr' },
      },
      payment: { meansCode: '30', accounts: [] },
    });
    expect(invoice?.draft.dueDate).toBeUndefined();
    expect(invoice?.draft.processType).toBeUndefined();
    expect(invoice?.draft.paymentTerms).toBeUndefined();
    expect(lines(invoice)[0]?.vat.category).toBeUndefined();
    expect(invoice?.cells['buyer.legalId.id']).toBe('S!C2');
  });

  it('reads currencies, countries, units, natures and postcodes as French sheets write them', () => {
    const sheet = grid('S', [
      [
        'N° facture',
        'Devise',
        'Pays',
        'CP',
        'Désignation',
        'Unité',
        'Nature',
        'PU HT',
        'Catégorie TVA',
        'Taux TVA',
        'Bon de commande',
        'Conditions de paiement',
      ],
      ['F1', '€', 'be', 1000, 'x', 'Heures', 'Biens', 10, 'e', 0, 'BC-7', 'À réception'],
      ['F2', 'usd', 'Pérou', '75001', 'y', 'barils', null, 10, null, 20, null, null],
    ]);
    const seller: SellerProfile = {
      ...SELLER,
      defaults: { ...SELLER.defaults, operationCategory: 'mixed' },
    };
    const [a, b] = readSheet(sheet, detectMapping(sheet), seller).invoices;
    expect(a?.draft).toMatchObject({
      currency: 'EUR',
      processType: 'M1',
      purchaseOrderReference: 'BC-7',
      paymentTerms: 'À réception',
      buyer: { address: { country: 'BE', postCode: '01000' } },
      lines: [{ unitCode: 'HUR', nature: 'goods', vat: { category: 'E', rate: '0' } }],
    });
    expect(b?.draft).toMatchObject({
      currency: 'USD',
      buyer: { address: { country: 'Pérou', postCode: '75001' } },
      lines: [{ unitCode: 'barils' }],
    });
    expect(lines(b)[0]?.nature).toBeUndefined();
  });
});

describe('cellForPath', () => {
  const cells = { 'buyer.address.line1': 'S!B2', 'lines[0].price.net': 'S!D2', number: 'S!A2' };
  it('finds the cell itself, a mapped parent, or a mapped child', () => {
    expect(cellForPath(cells, 'number')).toBe('S!A2');
    expect(cellForPath(cells, 'lines[0].price.net.extra')).toBe('S!D2');
    expect(cellForPath(cells, 'buyer.address')).toBe('S!B2');
    expect(cellForPath(cells, 'buyer')).toBe('S!B2');
    expect(cellForPath(cells, 'totals.payable')).toBeUndefined();
  });
});

it('scores the 8 core fields of the eval', () => {
  expect(CORE_FIELDS).toHaveLength(8);
});
