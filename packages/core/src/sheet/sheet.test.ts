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

  it('maps the article reference, a discount in euros and a discount in percent', () => {
    const sheet = grid('S', [
      [
        'N° facture',
        'Réf client',
        'Code article',
        'Désignation',
        'Qté',
        'PU HT',
        'Remise',
        'Remise %',
      ],
      ['F1', 'C01', 'VIS-6', 'Vis inox', 10, 8.4, 4, { v: 0.1, t: '10%', f: '0%' }],
    ]);
    const m = detectMapping(sheet).mapping;
    expect([
      m.itemRef?.column,
      m.itemName?.column,
      m.lineDiscount?.column,
      m.lineDiscountPercent?.column,
    ]).toEqual(['C', 'D', 'G', 'H']);
    // A reference of something else, a rate, or what is left after the discount.
    for (const [header, field] of [
      ['Réf client', 'itemRef'],
      ['Réf commande', 'itemRef'],
      ['Remise %', 'lineDiscount'],
      ['Taux de remise', 'lineDiscount'],
      ['Total après remise', 'lineDiscount'],
      ['Prix remisé', 'lineDiscount'],
      ['Net remisé', 'lineDiscount'],
      ['Total après remise', 'lineDiscountPercent'],
      ['Montant remise', 'lineDiscountPercent'],
    ] as const)
      expect(headerScore(header, field), header).toBe(0);
    for (const header of ['Remise %', 'Remise (%)', '% remise', 'Taux de remise'])
      expect(headerScore(header, 'lineDiscountPercent'), header).toBe(0.95);
    // « Remise » over percentages is a percentage, whatever its header says; over euros, an amount.
    const rates = grid('S', [
      ['N° facture', 'Désignation', 'Remise'],
      ['F1', 'Vis inox', { v: 0.1, t: '10%', f: '0%' }],
    ]);
    expect(detectMapping(rates).mapping).toMatchObject({ lineDiscountPercent: { column: 'C' } });
    expect(detectMapping(rates).mapping.lineDiscount).toBeUndefined();
    expect(detectMapping(sheet).warnings.filter((w) => w.includes('pourcentage'))).toEqual([]);
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

  it('reads the article reference and the discount of each line', () => {
    const sheet = grid('S', [
      [
        'N° facture',
        'Désignation',
        'Réf article',
        'Qté',
        'PU HT',
        'Remise',
        'Montant HT',
        'Taux TVA',
      ],
      ['F1', 'Vis inox', 'vis-6', 10, 8.4, 4, 80, 20],
      ['F2', 'Pose', null, 2, 50, -10, 95, 20],
      ['F3', 'Pose', null, 1, 50, null, 50, 20],
      ['F4', 'Pose', null, 1, 50, { v: 0.1, t: '10%', f: '0%' }, 45, 20],
      ['F5', 'Pose', null, 1, 50, 'cinq', 45, 20],
    ]);
    const { invoices } = readSheet(sheet, detectMapping(sheet), SELLER);
    const [f1, f2, f3, f4, f5] = invoices;
    expect(lines(f1)[0]).toMatchObject({
      item: { name: 'Vis inox', sellerId: 'vis-6' },
      allowances: [{ amount: 400, reasonCode: '95', reason: 'Remise' }],
    });
    expect(computeInvoice(one(f1).draft).lines[0]?.netAmount).toBe(8_000);
    expect(f1?.cells).toMatchObject({
      'lines[0].item.sellerId': 'S!C2',
      'lines[0].allowances[0]': 'S!F2',
    });
    expect(f1?.problems).toEqual([]);
    // Typed -10 is 10 € off; 2 × 50 − 10 is not the 95 the sheet says.
    expect(lines(f2)[0]?.allowances).toMatchObject([{ amount: 1_000 }]);
    expect(f2?.problems.map((p) => [p.code, p.cell])).toEqual([['line_total_mismatch', 'S!G3']]);
    expect(f2?.problems[0]?.messageFr).toContain('remise (90,00');
    expect(lines(f3)[0]?.allowances).toEqual([]);
    // « 10 % » in the euros column is a percentage: 10 % of 50 €, as the sheet's 45 says.
    expect(f4?.problems).toEqual([]);
    expect(lines(f4)[0]?.allowances).toEqual([
      { percentage: '10', reasonCode: '95', reason: 'Remise' },
    ]);
    expect(computeInvoice(one(f4).draft).lines[0]?.allowances[0]).toMatchObject({
      amount: 500,
      baseAmount: 5_000,
    });
    expect(errors(one(f4).draft).some((i) => i.ruleId === 'BR-41')).toBe(false);
    // A discount that is no number stays without an amount, and BR-41 stops it on its cell.
    expect(lines(f5)[0]?.allowances).toEqual([{ reasonCode: '95', reason: 'Remise' }]);
    const br41 = errors(one(f5).draft).find((i) => i.ruleId === 'BR-41');
    expect(br41 && cellForPath(one(f5).cells, br41.path)).toBe('S!F6');
    expect(errors(one(f1).draft).some((i) => i.ruleId === 'BR-41')).toBe(false);

    // Without a unit price, the line total is after the discount: the price is what it was before.
    const net = grid('S', [
      ['N° facture', 'Désignation', 'Qté', 'Remise', 'Montant HT', 'Taux TVA'],
      ['F1', 'Pose', 2, 10, 90, 20],
    ]);
    const [only] = readSheet(net, detectMapping(net), SELLER).invoices;
    expect(lines(only)[0]?.price.net).toBe('50');
    expect(computeInvoice(one(only).draft).lines[0]?.netAmount).toBe(9_000);
  });

  it('reads a « Remise % » column: 10, 10 % and an Excel percent cell', () => {
    const sheet = grid('S', [
      ['N° facture', 'Désignation', 'Qté', 'PU HT', 'Remise %', 'Montant HT', 'Taux TVA'],
      ['F1', 'Pose', 3, 45.5, 7.5, 126.26, 20],
      ['F2', 'Pose', 2, 50, '10 %', 90, 20],
      ['F3', 'Pose', 1, 200, { v: 0.05, t: '5%', f: '0%' }, 190, 20],
      ['F4', 'Pose', 1, 100, 10, 95, 20],
    ]);
    const mapping = detectMapping(sheet);
    expect(mapping.mapping.lineDiscountPercent?.column).toBe('E');
    expect(mapping.mapping.lineDiscount).toBeUndefined();
    const { invoices } = readSheet(sheet, mapping, SELLER);
    const net = (i: (typeof invoices)[number] | undefined) =>
      computeInvoice(one(i).draft).lines[0]?.netAmount;
    // 3 × 45,50 = 136,50 ; 7,5 % = 10,24 (rounded) ; 126,26 as the sheet says.
    expect(invoices.map((i) => lines(i)[0]?.allowances?.[0]?.percentage)).toEqual([
      '7.5',
      '10',
      '5',
      '10',
    ]);
    expect(invoices.map(net)).toEqual([12_626, 9_000, 19_000, 9_000]);
    expect(invoices.slice(0, 3).flatMap((i) => i.problems)).toEqual([]);
    expect(invoices[3]?.problems.map((p) => [p.code, p.cell])).toEqual([
      ['line_total_mismatch', 'S!F5'],
    ]);
    expect(invoices[0]?.cells['lines[0].allowances[0]']).toBe('S!E2');

    // Without a unit price, the sheet's total stays exact: the discount is what makes it up.
    const totals = grid('S', [
      ['N° facture', 'Désignation', 'Qté', 'Remise %', 'Montant HT', 'Taux TVA'],
      ['F1', 'Pose', 2, 10, 90, 20],
      ['F2', 'Pose', 1, 10, 33.33, 20],
    ]);
    const [t1, t2] = readSheet(totals, detectMapping(totals), SELLER).invoices;
    expect(lines(t1)[0]).toMatchObject({
      price: { net: '50' },
      allowances: [{ amount: 1_000, percentage: '10', baseAmount: 10_000 }],
    });
    expect(lines(t2)[0]?.allowances?.[0]).toMatchObject({ amount: 370, baseAmount: 3_703 });
    expect([t1, t2].map(net)).toEqual([9_000, 3_333]);
  });

  it('names a TTC amount, a discount taken twice and a percentage typed as euros (A1, A3)', () => {
    const sheet = grid('S', [
      ['N° facture', 'Désignation', 'Qté', 'PU HT', 'Remise', 'Montant HT', 'Taux TVA'],
      ['F1', 'Chaise', 10, 40, null, 480, 20],
      ['F2', 'Chaise', 10, 40, 40, 320, 20],
      ['F3', 'Chaise', 10, 40, 10, 360, 20],
      ['F4', 'Chaise', 10, 40, null, 410, 20],
      ['F5', 'Chaise', 10, 40, null, 400, 20],
    ]);
    const { invoices } = readSheet(sheet, detectMapping(sheet), SELLER);
    const checks = invoices.map((i) =>
      i.problems.map((p) => p.check && [p.check.message, p.check.cell, p.check.amount]),
    );
    expect(checks).toEqual([
      [['A1.sheet', 'S!F2', 8_000]],
      [['A3.twice', 'S!F3', 4_000]],
      [['A3.percent', 'S!F4', 3_000]],
      // Without formulas read, a different amount is a warning, not a mistake: the sheet may round.
      [undefined],
      [],
    ]);
    expect(invoices[0]?.problems[0]?.messageFr).toBe(
      "Sur la facture F1, le montant de la ligne en S!F2 (480,00\u00a0€) comprend la TVA à 20 % : le montant HT est 400,00\u00a0€. La facture électronique utilise 400,00\u00a0€ HT ; corrigez la feuille pour qu'elle dise la même chose.",
    );
    expect(invoices[2]?.problems[0]?.messageFr).toContain('a retiré 10 %');
    // The electronic invoice keeps quantity × price − discount whatever the sheet says.
    expect(computeInvoice(one(invoices[0]).draft).lines[0]?.netAmount).toBe(40_000);
  });

  it('calls a typed amount that no formula keeps in step a mistake (A2)', () => {
    const rows = [
      ['N° facture', 'Désignation', 'Qté', 'PU HT', 'Montant HT', 'Taux TVA', 'TTC'],
      ['F1', 'Chaise', 10, 40, 410, 20, 490],
      ['F2', 'Chaise', 10, 40, { v: 410, fx: true }, 20, { v: 490, fx: true }],
      ['F3', 'Chaise', 10, 40, 400, 20, 480],
    ] as const;
    const read = (formulas?: boolean) => {
      const sheet = { ...grid('S', rows), ...(formulas !== undefined && { formulas }) };
      return readSheet(sheet, detectMapping(sheet), SELLER).invoices.map((i) =>
        i.problems.map((p) => [p.code, p.check?.message, p.check?.amount]),
      );
    };
    expect(read(true)).toEqual([
      [
        ['line_total_mismatch', 'A2.line', 1_000],
        ['total_mismatch', 'A2.total', 1_000],
      ],
      // A formula that computes something else: the sheet's own logic, a warning.
      [
        ['line_total_mismatch', undefined, undefined],
        ['total_mismatch', undefined, undefined],
      ],
      [],
    ]);
    // A reader that did not look at formulas cannot tell typed from computed.
    expect(read()).toEqual(read(false).map((p) => p.map(([code]) => [code, undefined, undefined])));
    const sheet = { ...grid('S', rows), formulas: true };
    const [f1] = readSheet(sheet, detectMapping(sheet), SELLER).invoices;
    expect(f1?.problems.map((p) => p.messageFr)).toEqual([
      "Sur la facture F1, le montant de la ligne en S!E2 est tapé à la main (410,00\u00a0€) et ne suit plus quantité × prix (400,00\u00a0€) : 10,00\u00a0€ d'écart. La facture électronique utiliserait 400,00\u00a0€ ; remettez la formule, ou corrigez la quantité ou le prix.",
      "Sur la facture F1, le total TTC en S!G2 est tapé à la main (490,00\u00a0€) et ne correspond plus aux lignes (480,00\u00a0€) : 10,00\u00a0€ d'écart. La facture électronique utiliserait 480,00\u00a0€ ; remettez la formule du total, ou corrigez les lignes.",
    ]);
  });

  it('names an invoice without a number in its checks', () => {
    const sheet = {
      ...grid('S', [
        ['Désignation', 'Qté', 'PU HT', 'Montant HT', 'Taux TVA'],
        ['Chaise', 10, 40, 410, 20],
      ]),
      formulas: true,
    };
    const [only] = readSheet(sheet, detectMapping(sheet), SELLER).invoices;
    expect(only?.problems[0]?.messageFr).toMatch(/^Sur la facture sans numéro, /);
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

describe('BTP columns', () => {
  const spaces = (text: string | undefined) => text?.replace(/\s/g, ' ');
  const situations = grid('Situations', [
    [
      'N° facture',
      'Client',
      'Chantier',
      'Situation n°',
      'Cumul des travaux HT',
      'Désignation',
      'Qté',
      'PU HT',
      'Taux TVA',
      'RG %',
    ],
    ['S-003', 'SCI Les Tilleuls', 'CH-12', 3, 62000, 'Gros œuvre', 1, 22000, 20, 5],
    ['S-004', 'SCI Les Tilleuls', 'CH-12', 'trois', 70000, 'Gros œuvre', 1, 8000, 20, ''],
    ['S-005', 'SCI Les Tilleuls', 'CH-12', 'S5', 80000, 'Gros œuvre', 1, 10000, 20, 6],
  ]);

  it('maps the chantier, the situation, its cumul and the retenue by their usual headers', () => {
    expect(detectMapping(situations).mapping).toMatchObject({
      chantier: { column: 'C' },
      situation: { column: 'D' },
      cumulative: { column: 'E' },
      retenueRate: { column: 'J' },
    });
    for (const [header, field] of [
      ['Adresse du chantier', 'chantier'],
      ['Cumul situation', 'situation'],
      ['Montant de la situation', 'situation'],
      ['RG %', 'retenue'],
      ['Montant RG', 'retenueRate'],
      ['Libération de la retenue', 'retenue'],
      ['Cumul TTC', 'cumulative'],
    ] as const)
      expect(headerScore(header, field), header).toBe(0);
    // « Retenue de garantie » over euros is an amount; over percent cells, a rate.
    const euros = grid('S', [
      ['N° facture', 'Désignation', 'Qté', 'PU HT', 'Taux TVA', 'Retenue de garantie'],
      ['F1', 'Pose', 1, 1000, 20, 60],
    ]);
    const percents = grid('S', [
      ['N° facture', 'Désignation', 'Qté', 'PU HT', 'Taux TVA', 'Retenue de garantie'],
      ['F1', 'Pose', 1, 1000, 20, { v: 0.05, t: '5%', f: '0%' }],
    ]);
    expect(detectMapping(euros).mapping).toMatchObject({ retenue: { column: 'F' } });
    expect(detectMapping(euros).mapping.retenueRate).toBeUndefined();
    expect(detectMapping(percents).mapping).toMatchObject({ retenueRate: { column: 'F' } });
    expect(detectMapping(percents).mapping.retenue).toBeUndefined();
    const [amount] = readSheet(euros, detectMapping(euros), SELLER).invoices;
    const [rate] = readSheet(percents, detectMapping(percents), SELLER).invoices;
    expect(amount?.draft.btp).toEqual({ retenue: { amount: 6_000 } });
    expect(spaces(amount?.draft.notes?.[3]?.text)).toMatch(
      /^Clause de réserve : retenue de garantie de 60,00 € sur le montant TTC/,
    );
    expect(rate?.draft.btp).toEqual({ retenue: { rateBps: 500, amount: 6_000 } });
  });

  it('writes the chantier as BT-11, the retenue as a note ABU and the situation as a note AAI', () => {
    const [s3] = readSheet(situations, detectMapping(situations), SELLER).invoices;
    const draft = one(s3).draft;
    // 22 000 € HT at 20 %: 26 400 € TTC, 5 % of it held back.
    expect(draft).toMatchObject({
      projectReference: 'CH-12',
      btp: {
        retenue: { rateBps: 500, amount: 132_000 },
        situation: { number: 3, cumulative: 6_200_000 },
      },
    });
    expect(draft.notes?.slice(3).map((n) => [n.subjectCode, spaces(n.text)])).toEqual([
      [
        'ABU',
        "Clause de réserve : retenue de garantie de 5 % sur le montant TTC, soit 1 320,00 €, libérée un an après la réception des travaux sauf opposition motivée du maître d'ouvrage (loi n° 71-584 du 16 juillet 1971).",
      ],
      ['AAI', 'Situation de travaux n° 3. Cumul des travaux à ce jour : 62 000,00 € HT.'],
    ]);
    expect(one(s3).cells).toMatchObject({
      projectReference: 'Situations!C2',
      'btp.situation.number': 'Situations!D2',
      'btp.situation.cumulative': 'Situations!E2',
      'btp.retenue.rateBps': 'Situations!J2',
    });
    expect(one(s3).problems).toEqual([]);
    // The notes are well formed (the buyer's SIREN and address are another column's business).
    expect(errors(draft).filter((i) => i.path.startsWith('notes'))).toEqual([]);
    // The note is there: BTP-RG-03 has nothing to say.
    const btp = { retenue: draft.btp?.retenue };
    expect(validate(computeInvoice(draft), { ...ctx, btp }).map((i) => i.ruleId)).not.toContain(
      'BTP-RG-03',
    );
  });

  it('names a cell it cannot read, and points a retenue over 5 % at its cell', () => {
    const [, s4, s5] = readSheet(situations, detectMapping(situations), SELLER).invoices;
    expect(one(s4).problems.map((p) => [p.code, p.cell, p.messageFr])).toEqual([
      [
        'unreadable',
        'Situations!D3',
        "La colonne « N° de situation » contient « trois », que nous ne savons pas lire. Cette valeur n'est pas reprise dans la facture électronique : corrigez la cellule.",
      ],
    ]);
    expect(one(s4).draft.btp).toBeUndefined();
    expect(one(s4).draft.notes).toHaveLength(3);
    // « S5 » is situation 5; 6 % is over the law's 5 %.
    const draft = one(s5).draft;
    expect(draft.btp?.situation).toEqual({ number: 5, cumulative: 8_000_000 });
    const issue = validate(computeInvoice(draft), {
      ...ctx,
      btp: { retenue: draft.btp?.retenue },
    }).find((i) => i.ruleId === 'BTP-RG-01');
    expect(cellForPath(one(s5).cells, one(issue).path)).toBe('Situations!J4');
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
