// Credit notes (plan §4): a sent invoice is cancelled only by a credit note (type 381) that names it
// as preceding invoice (BG-3, rule BR-FR-CO-05). Built as golden invoice 10 is: the same parties,
// lines, notes and payment terms, no due date. The numbers of a company's credit notes form their own
// series, `AV<year>-<n>`, beside its invoices.
import type { InvoiceDraft } from './model';

export const CREDIT_NOTE_TYPE = '381';

/** The full credit note of `original` (its draft, numbered and dated as the platform got it). */
export function creditNoteDraft(
  original: InvoiceDraft,
  issued: { number: string; issueDate: string },
  credit: { number: string; issueDate: string },
): InvoiceDraft {
  const { dueDate: _due, ...rest } = structuredClone(original);
  return {
    ...rest,
    typeCode: CREDIT_NOTE_TYPE,
    number: credit.number,
    issueDate: credit.issueDate,
    precedingInvoices: [{ number: issued.number, issueDate: issued.issueDate }],
  };
}

const SERIES = /^AV(\d{4})-(\d+)$/;

/**
 * The next number of the credit-note series of `year`, after `taken` (the series' numbers already
 * used; other numbers are ignored). Four digits at least, as the golden credit note.
 */
export function nextCreditNumber(year: string, taken: Iterable<string>): string {
  let last = 0;
  for (const number of taken) {
    const m = SERIES.exec(number.trim());
    if (m && m[1] === year) last = Math.max(last, Number(m[2]));
  }
  return `AV${year}-${String(last + 1).padStart(4, '0')}`;
}
