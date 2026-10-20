// Amounts of a document's line as the checks read them: unit prices in cents with their fractions, and
// a sheet's net amount with the VAT taken out when the sheet wrote the TTC.
import { isDecimal, lineAmount, percentOf } from '../money';
import { quantityOf } from './link';
import type { CheckDoc, CheckLine } from './types';

/** A unit price in cents, kept with its fractions: 39.995 € is 3999.5. */
export const unitCents = (price: string | null) =>
  price !== null && isDecimal(price) ? Number(price) * 100 : null;

export const near = (a: number, b: number, tolerance = 1) => Math.abs(a - b) <= tolerance;

export const positiveRate = (rate: string | null) =>
  rate !== null && isDecimal(rate) && Number(rate) > 0 ? rate : null;

/**
 * A line's net amount, its VAT taken out when a sheet wrote the TTC in the amount column (A1): the
 * amount equals quantity × price × (1 + rate). Only a sheet's own documents: an invoice's amounts are
 * computed.
 */
export function sheetNet(
  doc: CheckDoc,
  line: CheckLine,
): { net: number | null; inclVat: number | null } {
  const rate = positiveRate(line.vatRate);
  if (doc.kind === 'invoice' || line.netAmount === null || !rate || !line.quantity) {
    return { net: line.netAmount, inclVat: null };
  }
  const ht = line.netPrice ? lineAmount(line.quantity, line.netPrice) : null;
  if (ht === null || ht === line.netAmount) return { net: line.netAmount, inclVat: null };
  const vat = percentOf(ht, rate);
  return vat !== null && near(line.netAmount, ht + vat)
    ? { net: ht, inclVat: line.netAmount }
    : { net: line.netAmount, inclVat: null };
}

/** What one unit of the line costs, its discount taken off, in cents with fractions; null: not known. */
export function unitNet(doc: CheckDoc, line: CheckLine): number | null {
  const quantity = quantityOf(line.quantity);
  const { net } = sheetNet(doc, line);
  if (quantity !== null && quantity > 0 && net !== null) return net / quantity;
  return unitCents(line.netPrice);
}
