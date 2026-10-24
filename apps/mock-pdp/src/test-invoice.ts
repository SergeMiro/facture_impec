// Test invoices for the mock: golden invoice 01 with the number and dates a test needs.
import { readFileSync } from 'node:fs';
import { computeInvoice, type InvoiceDraft, toCii, toUbl } from '@fi/core';

const golden = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/golden/01-services-standard-rate.json', import.meta.url),
    'utf8',
  ),
) as { draft: InvoiceDraft };

export function draft(number: string, change: (d: InvoiceDraft) => void = () => {}): InvoiceDraft {
  const d = structuredClone(golden.draft);
  d.number = number;
  change(d);
  return d;
}

export const cii = (d: InvoiceDraft) => toCii(computeInvoice(d));
export const ubl = (d: InvoiceDraft) => toUbl(computeInvoice(d));

/** Cents due on the invoice (BT-115). */
export const payableOf = (d: InvoiceDraft) => computeInvoice(d).totals.payable ?? 0;
