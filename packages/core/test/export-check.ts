// Strict readers of the accountant export, for tests. checkFec: every rule of article A47 A-1 of the
// Livre des procédures fiscales that a flat file can break (text and sources in
// docs/ACCOUNTING_EXPORT.md), plus the BOFiP's reading (BOI-CF-IOR-60-40-20). It returns the problems
// found, none when the file passes. It checks the file, not the books: whether an extract covers a
// whole year is not its job. readCsv: the CSV as a French spreadsheet reads it.

const FIELDS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
];
/** VII 2°: « montant » and « sens » may replace « débit » and « crédit ». */
const FIELDS_SENS = FIELDS.map((f) => (f === 'Debit' ? 'Montant' : f === 'Credit' ? 'Sens' : f));
/** The table's « à blanc si non utilisé » fields: every other one is mandatory. */
const OPTIONAL = new Set([
  'CompAuxNum',
  'CompAuxLib',
  'EcritureLet',
  'DateLet',
  'Montantdevise',
  'Idevise',
]);
const DATES = new Set(['EcritureDate', 'PieceDate', 'DateLet', 'ValidDate']);
/** XII 2°: decimal comma, no thousands separator, the sign first or last. */
const NUMBER = /^(?:[+-]?\d+(?:,\d+)?|\d+(?:,\d+)?[+-])$/;

function realDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso);
}

/** Cents of a FEC number; the sign may be first or last. */
function cents(value: string): number {
  const negative = value.startsWith('-') || value.endsWith('-');
  const digits = value.replace(/[+-]/g, '');
  const [int = '0', frac = ''] = digits.split(',');
  const n = Number(int) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  return negative ? -n : n;
}

/** IX: SirenFECAAAAMMJJ (an optional extension and a « TEST- » prefix aside). */
export function checkFecName(name: string): string[] {
  const base = name.replace(/\.(txt|csv)$/i, '').replace(/^TEST-/, '');
  const m = /^(\d{9})FEC(\d{8})$/.exec(base);
  if (!m?.[2]) return [`name ${name}: not SirenFECAAAAMMJJ`];
  return realDate(m[2]) ? [] : [`name ${name}: ${m[2]} is not a date`];
}

export interface FecLine {
  [field: string]: string;
}

export function checkFec(text: string): { problems: string[]; lines: FecLine[] } {
  const problems: string[] = [];
  const lines: FecLine[] = [];
  // XII 1°: ASCII, ISO 8859-15 or UTF-8. A string that came from bytes that were not UTF-8 holds U+FFFD.
  if (text.includes('�')) problems.push('encoding: not valid UTF-8');
  if (text.startsWith('﻿')) problems.push('encoding: a BOM would become part of the first field');
  // VI 1° a: records separated by CR and/or LF.
  const records = text.split(/\r\n|\n|\r/);
  if (records.at(-1) === '') records.pop();
  const head = records[0] ?? '';
  // VI 1° c: tab or « | », one of them for the whole file (I 4°: unique and not equivocal).
  const separator = head.includes('\t') ? '\t' : head.includes('|') ? '|' : null;
  if (!separator) return { problems: [...problems, 'separator: neither tab nor |'], lines };
  if (separator === '\t' && head.includes('|'))
    problems.push('separator: tab and | both in the header');
  // VII 4°: the first line holds the field names, the 18 of the table in order (VII 1°, VIII).
  const names = head.split(separator);
  const sens = names[11] === 'Montant';
  const expected = sens ? FIELDS_SENS : FIELDS;
  if (names.length < 18 || expected.some((f, i) => names[i] !== f)) {
    problems.push(`header: expected ${expected.join(',')}, got ${names.join(',')}`);
    return { problems, lines };
  }

  records.slice(1).forEach((record, index) => {
    const at = `line ${index + 2}`;
    const values = record.split(separator);
    if (values.length !== names.length) {
      problems.push(`${at}: ${values.length} fields instead of ${names.length}`);
      return;
    }
    const line: FecLine = Object.fromEntries(names.map((n, i) => [n, values[i] ?? '']));
    lines.push(line);
    for (const name of expected) {
      const value = line[name] ?? '';
      if (value === '') {
        if (!OPTIONAL.has(name)) problems.push(`${at}: ${name} is empty`);
        continue;
      }
      // BOFiP § 70: an unused field stays empty, never zeros or spaces.
      if (value.trim() !== value) problems.push(`${at}: ${name} has leading or trailing spaces`);
      if (DATES.has(name) && !realDate(value))
        problems.push(`${at}: ${name} ${value} is not AAAAMMJJ`);
    }
    // VII 1° 5: the first three characters of the account are digits of the plan comptable.
    if (!/^\d{3}/.test(line.CompteNum ?? '')) problems.push(`${at}: CompteNum ${line.CompteNum}`);
    if (sens) {
      if (!NUMBER.test(line.Montant ?? '')) problems.push(`${at}: Montant ${line.Montant}`);
      // X: « D » / « C », or « +1 » / « -1 » with no space.
      if (!['D', 'C', '+1', '-1'].includes(line.Sens ?? ''))
        problems.push(`${at}: Sens ${line.Sens}`);
    } else {
      // BOFiP § 210: both filled with a number, the unused one with zero.
      for (const name of ['Debit', 'Credit']) {
        if (!NUMBER.test(line[name] ?? ''))
          problems.push(`${at}: ${name} ${line[name]} is not a number`);
      }
    }
    if (line.Montantdevise && !NUMBER.test(line.Montantdevise)) {
      problems.push(`${at}: Montantdevise ${line.Montantdevise}`);
    }
    if (line.Montantdevise && !line.Idevise) problems.push(`${at}: Montantdevise without Idevise`);
  });
  if (problems.length > 0) return { problems, lines };

  // Each entry balances; numbers follow « une séquence continue » (VII 1° 3); entries are in
  // chronological order of validation (VII 1°).
  const entries = new Map<string, { debit: number; credit: number; first: number }>();
  lines.forEach((line, i) => {
    const key = `${line.JournalCode}\u0000${line.EcritureNum}`;
    const entry = entries.get(key) ?? { debit: 0, credit: 0, first: i };
    if (sens) {
      const amount = cents(line.Montant ?? '0');
      if (line.Sens === 'D' || line.Sens === '+1') entry.debit += amount;
      else entry.credit += amount;
    } else {
      entry.debit += cents(line.Debit ?? '0');
      entry.credit += cents(line.Credit ?? '0');
    }
    if (entry.first !== i && lines[i - 1]?.EcritureNum !== line.EcritureNum) {
      problems.push(`entry ${line.EcritureNum}: its lines are not together`);
    }
    entries.set(key, entry);
    if (i > 0 && (line.ValidDate ?? '') < (lines[i - 1]?.ValidDate ?? '')) {
      problems.push(`line ${i + 2}: ValidDate goes back in time`);
    }
  });
  for (const [key, e] of entries) {
    if (e.debit !== e.credit) {
      problems.push(
        `entry ${key.split('\u0000')[1]}: debit ${e.debit} ≠ credit ${e.credit} (cents)`,
      );
    }
  }
  const numbers = [...new Set(lines.map((l) => l.EcritureNum ?? ''))];
  if (numbers.every((n) => /^\d+$/.test(n))) {
    numbers.forEach((n, i) => {
      if (i > 0 && Number(n) !== Number(numbers[i - 1]) + 1) {
        problems.push(`entry ${n}: follows ${numbers[i - 1]}, the sequence is broken`);
      }
    });
  }
  return { problems: [...new Set(problems)], lines };
}

/**
 * Reads a `;`-separated CSV as a French spreadsheet would (RFC 4180 quoting, a leading BOM dropped) and
 * checks that every record has the header's number of cells.
 */
export function readCsv(text: string): { problems: string[]; rows: string[][] } {
  const problems: string[] = [];
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') problems.push(`bare line break at ${i}`);
    else cell += ch;
  }
  if (quoted) problems.push('unterminated quote');
  if (cell !== '' || row.length > 0) {
    problems.push('no CRLF after the last record');
    rows.push([...row, cell]);
  }
  const width = rows[0]?.length ?? 0;
  rows.forEach((r, i) => {
    if (r.length !== width) problems.push(`record ${i + 1}: ${r.length} cells instead of ${width}`);
  });
  return { problems, rows };
}
