import { describe, expect, it } from 'vitest';
import { computeGolden, golden } from '../test/fixtures';
import { computeInvoice, documentTotals, lineNetAmount, vatBreakdown } from './compute';
import { EN16931_SPECIFICATION, type Line } from './model';

const line = (over: Partial<Line> = {}): Line => ({
  quantity: '1',
  price: { net: '10.00' },
  vat: { category: 'S', rate: '20' },
  item: { name: 'Article' },
  allowances: [],
  charges: [],
  ...over,
});

describe('lineNetAmount', () => {
  it('multiplies quantity by price per base quantity', () => {
    expect(
      lineNetAmount(line({ quantity: '2500', price: { net: '12.50', baseQuantity: '100' } })),
    ).toBe(31250);
  });

  it('subtracts line allowances and adds line charges', () => {
    const l = line({
      quantity: '4',
      price: { net: '210.00' },
      allowances: [{ amount: 4200 }],
      charges: [{ amount: 1200 }],
    });
    expect(lineNetAmount(l)).toBe(81000);
  });

  it('counts a missing or malformed quantity or price as zero', () => {
    expect(lineNetAmount(line({ quantity: undefined }))).toBe(0);
    expect(lineNetAmount(line({ quantity: 'trois' }))).toBe(0);
    expect(lineNetAmount(line({ price: {} }))).toBe(0);
  });
});

describe('vatBreakdown', () => {
  it('groups by category and rate in order of appearance, whatever the rate spelling', () => {
    const lines = [
      line({ netAmount: 10000, vat: { category: 'S', rate: '20.00' } }),
      line({ netAmount: 2000, vat: { category: 'S', rate: '5.5' } }),
      line({ netAmount: 5000, vat: { category: 'S', rate: '20' } }),
    ];
    expect(vatBreakdown(lines, [], [])).toEqual([
      { category: 'S', rate: '20', taxableAmount: 15000, taxAmount: 3000 },
      { category: 'S', rate: '5.5', taxableAmount: 2000, taxAmount: 110 },
    ]);
  });

  it('includes document charges and allowances in the taxable base', () => {
    const result = vatBreakdown(
      [line({ netAmount: 25000 })],
      [{ amount: 1250, vatCategory: 'S', vatRate: '20' }],
      [{ amount: 1500, vatCategory: 'S', vatRate: '20' }],
    );
    expect(result).toEqual([{ category: 'S', rate: '20', taxableAmount: 25250, taxAmount: 5050 }]);
  });

  it('gives category O no rate and copies exemption reasons', () => {
    const result = vatBreakdown(
      [line({ netAmount: 12000, vat: { category: 'O', rate: '0' } })],
      [],
      [],
      [{ category: 'O', code: 'VATEX-EU-O', reason: 'Non soumis à la TVA' }],
    );
    expect(result).toEqual([
      {
        category: 'O',
        taxableAmount: 12000,
        taxAmount: 0,
        exemptionCode: 'VATEX-EU-O',
        exemptionReason: 'Non soumis à la TVA',
      },
    ]);
  });

  it('leaves out items without a category and counts a malformed rate as no tax', () => {
    const result = vatBreakdown(
      [
        line({ netAmount: 100, vat: {} }),
        line({ netAmount: 1000, vat: { category: 'S', rate: '5,5' } }),
      ],
      [],
      [],
    );
    expect(result).toEqual([{ category: 'S', rate: '5,5', taxableAmount: 1000, taxAmount: 0 }]);
  });
});

describe('documentTotals', () => {
  it('subtracts what was already paid', () => {
    const breakdown = [{ category: 'S', rate: '20', taxableAmount: 500000, taxAmount: 100000 }];
    expect(documentTotals([line({ netAmount: 500000 })], [], [], breakdown, 180000)).toEqual({
      lineTotal: 500000,
      taxExclusive: 500000,
      taxTotal: 100000,
      taxInclusive: 600000,
      prepaid: 180000,
      payable: 420000,
    });
  });
});

describe('computeInvoice', () => {
  it('fills the specification, line amounts, VAT breakdown and totals', () => {
    const invoice = computeGolden(golden('25-many-lines-rounding'));
    expect(invoice.specificationId).toBe(EN16931_SPECIFICATION);
    expect(invoice.lines.every((l) => Number.isInteger(l.netAmount))).toBe(true);
    expect(invoice.vatBreakdown.map((b) => b.rate)).toEqual(['5.5', '10', '20']);
    expect(invoice.totals).toEqual({
      lineTotal: 59513,
      taxExclusive: 59513,
      taxTotal: 7286,
      taxInclusive: 66799,
      payable: 66799,
    });
  });

  it('keeps the VAT total in the accounting currency', () => {
    expect(computeGolden(golden('16-foreign-currency')).totals.taxTotalAccountingCurrency).toBe(
      36800,
    );
  });

  it('rejects a draft that does not have the model shape', () => {
    expect(() =>
      computeInvoice({ seller: {}, buyer: {}, lines: [{ quantity: 3 }] } as never),
    ).toThrow();
  });
});
