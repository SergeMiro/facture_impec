// A worksheet written as a grid, the way the add-in's SheetReader sends it: tests, evals and fakes.
import { columnLetters, type RawCell, type SheetSnapshot } from './cells';

/** A cell as Excel holds it: plain values, or `{ v, t, f }` for a value with its text and format. */
export type GridCell = string | number | null | { v: RawCell['value']; t?: string; f?: string };

export function grid(
  sheet: string,
  rows: readonly (readonly GridCell[])[],
  firstRow = 1,
): SheetSnapshot {
  return {
    sheet,
    rows: rows.map((cells, i) => ({
      row: firstRow + i,
      cells: cells.map((c, j): RawCell => {
        const col = columnLetters(j + 1);
        if (c === null) return { col, value: '', text: '' };
        if (typeof c === 'object') {
          return { col, value: c.v, text: c.t ?? String(c.v ?? ''), ...(c.f && { format: c.f }) };
        }
        return { col, value: c, text: String(c) };
      }),
    })),
  };
}
