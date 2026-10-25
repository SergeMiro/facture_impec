// The next invoice number when nobody types it (memory M6 prepares invoices): the series of the
// company's latest invoice, one more than the highest number in it, as wide. A series that names its
// year (« F-2026-041 ») starts again at 1 in a new year; with no invoice yet, `F<year>-0001`. The
// credit notes' own series (credit.ts) is not followed.
import { CREDIT_SERIES } from './credit';
import { series } from './rules/util';

export interface Issued {
  number: string;
  issueDate: string;
}

export function nextInvoiceNumber(issued: Iterable<Issued>, issueDate: string): string {
  const year = issueDate.slice(0, 4);
  const numbered = [...issued].flatMap((i) => {
    const number = i.number.trim();
    const s = CREDIT_SERIES.test(number) ? null : series(number);
    return s ? [{ ...s, issueDate: i.issueDate }] : [];
  });
  let latest: (typeof numbered)[number] | undefined;
  for (const x of numbered) {
    if (
      !latest ||
      x.issueDate > latest.issueDate ||
      (x.issueDate === latest.issueDate && x.n > latest.n)
    )
      latest = x;
  }
  if (!latest) return `F${year}-0001`;
  const was = latest.issueDate.slice(0, 4);
  const at = latest.prefix.lastIndexOf(was);
  const prefix =
    was !== year && at >= 0
      ? `${latest.prefix.slice(0, at)}${year}${latest.prefix.slice(at + was.length)}`
      : latest.prefix;
  const last = Math.max(0, ...numbered.filter((x) => x.prefix === prefix).map((x) => x.n));
  return `${prefix}${String(last + 1).padStart(latest.width, '0')}`;
}
