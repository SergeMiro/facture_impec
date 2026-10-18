// Dates are ISO "YYYY-MM-DD" strings (CLAUDE.md rule 4). Invoice dates are calendar dates without a
// time zone; "today" is taken in Europe/Paris, where the seller issues the invoice.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Today's date in Europe/Paris as "YYYY-MM-DD". */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Whole days from a to b (b − a). Both must be ISO dates. */
export function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/** "2026-10-17" → "20261017" (CII format 102). */
export const toCiiDate = (iso: string) => iso.replaceAll('-', '');

/** "20261017" → "2026-10-17"; anything else is returned unchanged so FF-FMT-03 can report it. */
export const fromCiiDate = (value: string) =>
  /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
