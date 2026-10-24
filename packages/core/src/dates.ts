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

/** The hour (0–23) in Europe/Paris. */
export function parisHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
}

/** The time of day in Europe/Paris as "HH:MM". */
export function parisTime(at: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** `iso` plus `days` calendar days (negative goes back). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * `iso` plus `months` calendar months, the day kept or, past the month's end, its last day:
 * 2026-08-31 + 6 months = 2027-02-28 (a renewal is never pushed into the month after).
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Whole days from a to b (b − a). Both must be ISO dates. */
export function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/** ISO 8601 week of a date: "2026-10-19" → "2026-W43" (the weekly report is sent once per week). */
export function isoWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  // The week belongs to the year of its Thursday.
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** 1 = Monday … 7 = Sunday. */
export const isoWeekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7;

/** "2026-10-17" → "20261017" (CII format 102). */
export const toCiiDate = (iso: string) => iso.replaceAll('-', '');

/** "20261017" → "2026-10-17"; anything else is returned unchanged so FF-FMT-03 can report it. */
export const fromCiiDate = (value: string) =>
  /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
