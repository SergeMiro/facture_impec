// What the add-in's SheetReader sends (plan §5): the used range of one worksheet, cell by cell, with
// the value Excel stores and the text it displays, so every issue can point at `Feuil1!C14`.
import { z } from 'zod';

export const ColumnLetters = z.string().regex(/^[A-Z]{1,3}$/);

export const RawCell = z.object({
  col: ColumnLetters,
  /** What Excel stores: numbers for numbers and dates (serial days), '' for an empty cell. */
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  /** What Excel displays. */
  text: z.string(),
  /** Excel number format, e.g. "dd/mm/yyyy" or "0%". */
  format: z.string().optional(),
  /** The cell holds a formula (only said when the snapshot read formulas). */
  formula: z.literal(true).optional(),
});

export const RawRow = z.object({ row: z.number().int().positive(), cells: z.array(RawCell) });

export const SheetSnapshot = z.object({
  sheet: z.string().min(1).max(31),
  rows: z.array(RawRow),
  /** The reader looked at formulas: a cell without `formula` was typed (A2). */
  formulas: z.boolean().optional(),
});

export type RawCell = z.infer<typeof RawCell>;
export type RawRow = z.infer<typeof RawRow>;
export type SheetSnapshot = z.infer<typeof SheetSnapshot>;

/** "A" → 1, "AA" → 27. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1 → "A", 27 → "AA". */
export function columnLetters(index: number): string {
  let s = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** Excel quotes a sheet name that is not a plain word: `'Factures 2026'!C14`. */
export function cellAddress(sheet: string, col: string, row: number): string {
  const plain = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(sheet) && !/^[A-Z]{1,3}\d+$/i.test(sheet);
  const name = plain ? sheet : `'${sheet.replaceAll("'", "''")}'`;
  return `${name}!${col}${row}`;
}

/** `'Factures 2026'!C14` → { sheet: 'Factures 2026', cell: 'C14' }. */
export function parseAddress(address: string): { sheet: string; cell: string } | null {
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!([A-Z]{1,3}\d+)$/.exec(address);
  if (!m) return null;
  const sheet = m[1] !== undefined ? m[1].replaceAll("''", "'") : (m[2] ?? '');
  return { sheet, cell: m[3] ?? '' };
}

/** True when the cell holds nothing a user typed. */
export const isBlank = (cell: RawCell | undefined): boolean =>
  cell === undefined ||
  cell.value === null ||
  (typeof cell.value === 'string' && cell.value.trim() === '' && cell.text.trim() === '');
