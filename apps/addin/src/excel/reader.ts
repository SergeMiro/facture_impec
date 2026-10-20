// SheetReader (plan §5): the only way the add-in reads a sheet. It returns RawRow[] with addresses,
// leaves out the two columns the add-in owns, and says where they are so StatusWriter reuses them.
import {
  columnIndex,
  columnLetters,
  parseAddress,
  type RawCell,
  type RawRow,
  type SheetSnapshot,
} from '@fi/core';
import type { UsedRange } from './port';

export const STATUS_HEADER = 'FI_Statut';
export const DETAIL_HEADER = 'FI_Détail';
/** The server reads at most this many rows per sync (apps/api workbooks.ts MAX_ROWS). */
export const MAX_ROWS = 5_000;

export interface SheetReading {
  snapshot: SheetSnapshot;
  /** Where FI_Statut / FI_Détail already are, when the add-in wrote them before. */
  owned: { status: string | null; detail: string | null };
  /** Last column letter of the user's data (owned columns excluded), '' on a blank sheet. */
  lastCol: string;
  /** Last row of the used range, owned columns included. */
  lastRow: number;
}

export class TooManyRows extends Error {
  constructor(readonly rows: number) {
    super(`${rows} rows, at most ${MAX_ROWS}`);
  }
}

/** `Factures!B3:F9` → column B, row 3. */
export function topLeft(address: string): { col: number; row: number } {
  const first = address.split(':')[0] ?? '';
  const cell = parseAddress(first)?.cell ?? first;
  const m = /^([A-Z]{1,3})(\d+)$/.exec(cell);
  if (!m?.[1] || !m[2]) throw new Error(`Unexpected range address: ${address}`);
  return { col: columnIndex(m[1]), row: Number(m[2]) };
}

const cellValue = (value: unknown): RawCell['value'] =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;

export function readUsedRange(sheet: string, range: UsedRange | null): SheetReading {
  const empty: SheetReading = {
    snapshot: { sheet, rows: [] },
    owned: { status: null, detail: null },
    lastCol: '',
    lastRow: 0,
  };
  if (!range || range.values.length === 0) return empty;
  const origin = topLeft(range.address);
  const owned: SheetReading['owned'] = { status: null, detail: null };
  for (const cells of range.text) {
    cells.forEach((text, c) => {
      const col = columnLetters(origin.col + c);
      if (text.trim() === STATUS_HEADER) owned.status ??= col;
      if (text.trim() === DETAIL_HEADER) owned.detail ??= col;
    });
  }
  const skip = new Set([owned.status, owned.detail].filter((c) => c !== null));

  const rows: RawRow[] = [];
  let lastCol = 0;
  range.values.forEach((values, r) => {
    const cells: RawCell[] = [];
    values.forEach((raw, c) => {
      const col = columnLetters(origin.col + c);
      if (skip.has(col)) return;
      const text = range.text[r]?.[c] ?? '';
      const value = cellValue(raw);
      if ((value === null || value === '') && text.trim() === '') return;
      const format = range.numberFormat[r]?.[c];
      // Excel gives a cell's value where it has no formula; text typed as « '=x » is its value too.
      const formula = range.formulas?.[r]?.[c];
      cells.push({
        col,
        value,
        text,
        ...(typeof format === 'string' && format !== 'General' && { format }),
        ...(typeof formula === 'string' &&
          formula.startsWith('=') &&
          formula !== raw && {
            formula: true as const,
          }),
      });
      lastCol = Math.max(lastCol, origin.col + c);
    });
    if (cells.length > 0) rows.push({ row: origin.row + r, cells });
  });
  if (rows.length > MAX_ROWS) throw new TooManyRows(rows.length);
  return {
    snapshot: { sheet, rows, ...(range.formulas && { formulas: true }) },
    owned,
    lastCol: lastCol > 0 ? columnLetters(lastCol) : '',
    lastRow: origin.row + range.values.length - 1,
  };
}

/** What MappingAgent reads (plan §6: the first 50 rows). */
export const detectionSample = (snapshot: SheetSnapshot): SheetSnapshot => ({
  sheet: snapshot.sheet,
  rows: snapshot.rows.slice(0, 50),
});

/** The two status columns: where they already are, else right after the user's data. */
export function statusColumns(reading: SheetReading): { statusCol: string; detailCol: string } {
  const after = columnIndex(reading.lastCol || 'A');
  const statusCol = reading.owned.status ?? columnLetters(reading.lastCol ? after + 1 : 1);
  const detailCol = reading.owned.detail ?? columnLetters(columnIndex(statusCol) + 1);
  return { statusCol, detailCol };
}

/** The header texts of one row, for the column pickers of Détection. */
export function headersOf(snapshot: SheetSnapshot, headerRow: number) {
  const row = snapshot.rows.find((r) => r.row === headerRow);
  const byCol = new Map((row?.cells ?? []).map((c) => [c.col, c.text.trim()]));
  const width = Math.max(
    0,
    ...snapshot.rows.flatMap((r) => r.cells.map((c) => columnIndex(c.col))),
  );
  return Array.from({ length: width }, (_, i) => {
    const col = columnLetters(i + 1);
    return { col, text: byCol.get(col) ?? '' };
  });
}
