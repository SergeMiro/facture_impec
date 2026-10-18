// The XML we write for every golden invoice, and for every CEN example read by our parsers, is
// valid against the official XSD and raises nothing in the official schematrons.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN16931_SPECIFICATION, type Invoice } from '../../src/model';
import { parseInvoiceXml, toCii, toUbl } from '../../src/xml';
import { computeGolden, goldens } from '../fixtures';
import { VENDOR } from './paths';
import { type OracleHit, runSchematron } from './schematron';
import { xsdErrors } from './xsd';

/**
 * Factur-X warns when ApplicableHeaderTradeDelivery is empty, but its XSD requires the element:
 * an invoice without a delivery date or address can only write it empty.
 */
const ALLOWED = new Set(['warning PEPPOL-EN16931-R008']);
const shown = (hits: readonly OracleHit[]) =>
  hits.map((h) => `${h.flag} ${h.id}`).filter((h) => !ALLOWED.has(h));

async function expectValidCii(invoice: Invoice) {
  const xml = toCii(invoice);
  expect(await xsdErrors('cii-d16b', xml)).toEqual([]);
  expect(await xsdErrors('facturx', xml)).toEqual([]);
  expect(shown(await runSchematron('cen-cii', xml))).toEqual([]);
  expect(shown(await runSchematron('facturx', xml))).toEqual([]);
}

async function expectValidUbl(invoice: Invoice) {
  const xml = toUbl(invoice);
  const schema = xml.includes('<CreditNote ') ? 'ubl-creditnote' : 'ubl-invoice';
  expect(await xsdErrors(schema, xml)).toEqual([]);
  expect(shown(await runSchematron('cen-ubl', xml))).toEqual([]);
}

describe.each(goldens.map((g) => [g.name, g] as const))('golden %s', (_, g) => {
  const invoice = computeGolden(g);
  it('CII: XSD D16B and Factur-X EN16931, CEN and Factur-X schematrons', () =>
    expectValidCii(invoice));
  it('UBL: XSD 2.1, CEN schematron', () => expectValidUbl(invoice));
});

const examples = ['cii', 'ubl'].flatMap((syntax) =>
  readdirSync(`${VENDOR}examples/${syntax}`)
    .sort()
    .map((file) => `${syntax}/${file}`),
);

describe.each(examples)('CEN example %s, read then written', (path) => {
  const { invoice: read } = parseInvoiceXml(readFileSync(`${VENDOR}examples/${path}`, 'utf8'));
  // Some examples declare XRechnung (BT-24), which Factur-X refuses: write them as plain EN 16931.
  const invoice = { ...read, specificationId: EN16931_SPECIFICATION };
  it('as CII', () => expectValidCii(invoice));
  it('as UBL', () => expectValidUbl(invoice));
});
