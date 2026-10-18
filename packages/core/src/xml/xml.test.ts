import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeGolden, FIXTURES, golden, goldens, TODAY } from '../../test/fixtures';
import type { Invoice } from '../model';
import { getRule, validate } from '../rules';
import {
  fromCii,
  fromUbl,
  InvoiceXmlError,
  type ParsedInvoice,
  parseInvoiceXml,
  toCii,
  toUbl,
} from './index';

/** `nature` is ours and never written (model.ts), so it cannot come back. */
const withoutNature = (inv: Invoice): Invoice => ({
  ...inv,
  lines: inv.lines.map(({ nature: _nature, ...line }) => line),
});

const expected = (name: string, syntax: 'cii' | 'ubl') =>
  fileURLToPath(new URL(`golden/${name}.${syntax}.xml`, FIXTURES));

const found = (parsed: ParsedInvoice) => parsed.issues.map((i) => [i.ruleId, i.path]);

describe.each(goldens.map((g) => [g.name, g] as const))('golden %s', (name, g) => {
  const invoice = computeGolden(g);

  it('writes the expected CII and reads it back unchanged', async () => {
    const xml = toCii(invoice);
    await expect(xml).toMatchFileSnapshot(expected(name, 'cii'));
    const parsed = fromCii(xml);
    expect(parsed.syntax).toBe('cii');
    expect(parsed.issues).toEqual([]);
    expect(parsed.invoice).toEqual(withoutNature(invoice));
  });

  it('writes the expected UBL and reads it back unchanged', async () => {
    const xml = toUbl(invoice);
    await expect(xml).toMatchFileSnapshot(expected(name, 'ubl'));
    const parsed = fromUbl(xml);
    expect(parsed.syntax).toBe('ubl');
    expect(parsed.issues).toEqual([]);
    expect(parsed.invoice).toEqual(withoutNature(invoice));
  });
});

const invoice = computeGolden(golden('01-services-standard-rate'));
const cii = toCii(invoice);
const ubl = toUbl(invoice);

describe('reading amounts', () => {
  it('rounds an amount with more than 2 decimals and says so (BR-FR-DEC-01)', () => {
    const parsed = fromCii(
      cii.replace('<ram:GrandTotalAmount>1620.00', '<ram:GrandTotalAmount>1620.005'),
    );
    expect(parsed.invoice.totals.taxInclusive).toBe(162001);
    expect(found(parsed)).toEqual([['BR-FR-DEC-01', 'totals.taxInclusive']]);
  });

  it('leaves out an amount that is not a number and says so (FF-FMT-04)', () => {
    const parsed = fromUbl(ubl.replace('>1620.00</cbc:PayableAmount>', '>abc</cbc:PayableAmount>'));
    expect(parsed.invoice.totals.payable).toBeUndefined();
    expect(found(parsed)).toEqual([['FF-FMT-04', 'totals.payable']]);
    expect(parsed.issues[0]?.params).toEqual({ value: 'abc' });
  });
});

describe('parseInvoiceXml', () => {
  it('dispatches on the root namespace', () => {
    expect(parseInvoiceXml(cii).syntax).toBe('cii');
    expect(parseInvoiceXml(ubl).syntax).toBe('ubl');
    const credit = toUbl(computeGolden(golden('10-credit-note')));
    expect(credit).toMatch(
      /^<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/m,
    );
    expect(parseInvoiceXml(credit).invoice.typeCode).toBe('381');
  });

  it.each([
    ['not XML', 'facture.xlsx', 'malformed'],
    ['an unclosed element', '<a><b></a>', 'malformed'],
    ['a DOCTYPE', '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', 'malformed'],
    ['an unknown root', '<Invoice xmlns="urn:example"/>', 'unknown'],
    ['a CII root name without its namespace', '<CrossIndustryInvoice/>', 'unknown'],
  ])('rejects %s', (_, xml, reason) => {
    expect(() => parseInvoiceXml(xml)).toThrowError(expect.objectContaining({ reason }));
    expect(() => parseInvoiceXml(xml)).toThrowError(InvoiceXmlError);
  });

  it('reads by namespace, whatever the prefixes', () => {
    const renamed = cii
      .replace(/\b(rsm|ram|udt|qdt):/g, '$1x:')
      .replace(/xmlns:(rsm|ram|udt|qdt)=/g, 'xmlns:$1x=');
    expect(renamed).not.toContain('<ram:');
    expect(fromCii(renamed).invoice).toEqual(fromCii(cii).invoice);

    const prefixed = ubl
      .replace(/<(\/?)Invoice\b/g, '<$1inv:Invoice')
      .replace('xmlns="', 'xmlns:inv="')
      .replace(/\b(cac|cbc):/g, '$1x:')
      .replace(/xmlns:(cac|cbc)=/g, 'xmlns:$1x=');
    expect(prefixed).toContain('<inv:Invoice xmlns:inv=');
    expect(fromUbl(prefixed).invoice).toEqual(fromUbl(ubl).invoice);
  });

  it('reads a UBL note whose code is not 3 characters as plain text', () => {
    const xml = ubl.replace(
      '<cbc:IssueDate>',
      '<cbc:Note>#ABCD#Texte</cbc:Note>\n  <cbc:IssueDate>',
    );
    const notes = fromUbl(xml).invoice.notes;
    expect(notes).toContainEqual({ text: '#ABCD#Texte' });
  });
});

// Each of these was first caught by the oracle (test/oracle/golden.oracle.test.ts) on a CEN example.
describe('syntax constraints the builders respect', () => {
  const count = (xml: string, tag: string) => xml.split(`<${tag}`).length - 1;
  const twoRates = computeGolden(golden('02-goods-two-rates'));
  const credit = computeGolden(golden('10-credit-note'));
  const account = { iban: 'FR7630006000011234567890189' };

  it('CII: BT-7 and BT-8 once, in the first VAT breakdown (CII-SR-461, CII-SR-462)', () => {
    const xml = toCii({ ...twoRates, taxPointDate: '2026-10-01', vatDueOn: 'invoice' });
    expect(count(xml, 'ram:ApplicableTradeTax>')).toBeGreaterThan(2);
    expect(count(xml, 'ram:TaxPointDate>')).toBe(1);
    expect(count(xml, 'ram:DueDateTypeCode>')).toBe(1);
  });

  it('UBL: BT-82 and the credit note BT-9 once, with several accounts (UBL-SR-45, UBL-SR-46)', () => {
    const payment = { meansCode: '30', meansText: 'Virement', accounts: [account, account] };
    const xml = toUbl({ ...credit, dueDate: '2026-11-30', payment });
    expect(count(xml, 'cac:PaymentMeans>')).toBe(2);
    expect(count(xml, 'cbc:PaymentDueDate>')).toBe(1);
    expect(xml.match(/name="Virement"/g)).toHaveLength(1);
  });

  it('UBL credit note: BT-9 and BT-11 have their own places and come back', () => {
    const payment = { meansCode: '30', accounts: [account] };
    const full = { ...credit, dueDate: '2026-11-30', projectReference: 'PRJ-7', payment };
    const xml = toUbl(full);
    expect(xml).toContain('<cbc:PaymentDueDate>2026-11-30</cbc:PaymentDueDate>');
    expect(xml).toContain('<cbc:DocumentTypeCode>50</cbc:DocumentTypeCode>');
    expect(fromUbl(xml).invoice).toEqual(withoutNature(full));
  });

  it('each reader refuses the other syntax', () => {
    expect(() => fromCii(ubl)).toThrowError(expect.objectContaining({ reason: 'unknown' }));
    expect(() => fromUbl(cii)).toThrowError(expect.objectContaining({ reason: 'unknown' }));
  });

  it('CII: BT-6 equal to BT-5 is left out (CEN CII BR-53)', () => {
    expect(toCii({ ...invoice, vatCurrency: 'EUR' })).not.toContain('TaxCurrencyCode');
    expect(toUbl({ ...invoice, vatCurrency: 'EUR' })).toContain('<cbc:TaxCurrencyCode>EUR');
  });

  it('VATEX codes in upper case both ways (the Factur-X schematron is case-sensitive)', () => {
    const vatBreakdown = invoice.vatBreakdown.map((b) => ({ ...b, exemptionCode: 'vatex-eu-o' }));
    for (const [write, read] of [
      [toCii, fromCii],
      [toUbl, fromUbl],
    ] as const) {
      const xml = write({ ...invoice, vatBreakdown });
      expect(xml).toContain('>VATEX-EU-O<');
      const lower = xml.replace('>VATEX-EU-O<', '>vatex-eu-o<');
      expect(read(lower).invoice.vatBreakdown[0]?.exemptionCode).toBe('VATEX-EU-O');
    }
  });

  it('UBL: without BT-110 (CII allows it), the VAT total is the sum of BT-117', () => {
    const xml = toUbl({ ...twoRates, totals: { ...twoRates.totals, taxTotal: undefined } });
    const tax = twoRates.vatBreakdown.reduce((sum, b) => sum + (b.taxAmount ?? 0), 0);
    expect(fromUbl(xml).invoice.totals.taxTotal).toBe(tax);
  });
});

// The CEN examples (vendor/cen-1.3.17/examples) pass the CEN schematron, so our parser must read
// them without complaint and our EN 16931 rules must agree with the schematron on them.
const EXAMPLES = new URL('../../vendor/cen-1.3.17/examples/', import.meta.url);
const examples = (['cii', 'ubl'] as const).flatMap((syntax) =>
  readdirSync(new URL(`${syntax}/`, EXAMPLES))
    .sort()
    .map((file) => [`${syntax}/${file}`, syntax] as const),
);

describe.each(examples)('CEN example %s', (path, syntax) => {
  const parsed = parseInvoiceXml(readFileSync(new URL(path, EXAMPLES), 'utf8'));

  it('is read without issues and passes our EN 16931 rules', () => {
    expect(parsed.syntax).toBe(syntax);
    expect(parsed.issues).toEqual([]);
    const errors = validate(parsed.invoice, { today: TODAY }).filter(
      (i) => i.severity === 'error' && getRule(i.ruleId).source === 'EN16931',
    );
    expect(errors.map((i) => `${i.ruleId} ${i.path}`)).toEqual([]);
  });

  it('is written back without losing anything we read', () => {
    const again =
      syntax === 'cii' ? fromCii(toCii(parsed.invoice)) : fromUbl(toUbl(parsed.invoice));
    expect(again.issues).toEqual([]);
    expect(again.invoice).toEqual(parsed.invoice);
  });
});
