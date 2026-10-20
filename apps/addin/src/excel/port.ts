// Everything the task pane asks of Excel goes through this port (plan §5): the real one wraps
// Office.js, the fake one is an in-memory sheet for the unit tests and the harness page.
import type { SheetSnapshot } from '@fi/core';

/** One worksheet's used range, as Excel returns it. */
export interface UsedRange {
  /** E.g. `Factures!A1:L20` or `'Factures 2026'!B3:F9`. */
  address: string;
  values: unknown[][];
  text: string[][];
  numberFormat: unknown[][];
  /** The formula of each cell, its value when it has none (docs/OFFICE.md § 5); absent: not read. */
  formulas?: unknown[][];
}

export type Tone = 'ok' | 'warning' | 'error' | 'progress' | 'neutral';

export interface StatusCell {
  row: number;
  status: string;
  detail: string;
  tone: Tone;
}

/** What StatusWriter writes into the two columns the add-in owns, for one sheet. */
export interface StatusPlan {
  sheet: string;
  headerRow: number;
  statusCol: string;
  detailCol: string;
  /** Rows cleared then written: headerRow + 1 … lastRow. */
  lastRow: number;
  cells: StatusCell[];
}

export interface ExcelPort {
  activeSheet(): Promise<string>;
  /** The visible sheets, in tab order: the « Registre » proposes those not checked yet. */
  sheetNames(): Promise<string[]>;
  /** The row of the active cell on the active sheet. */
  activeCell(): Promise<{ sheet: string; row: number }>;
  usedRange(sheet: string): Promise<UsedRange | null>;
  /** Activates the sheet and selects the cell (« Corriger dans la feuille »). */
  select(sheet: string, cell: string): Promise<void>;
  /** All plans in one batch: one sync. */
  writeStatus(plans: StatusPlan[]): Promise<void>;
  /** Per-workbook, non-secret settings (docs/OFFICE.md §4): saved inside the file. */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  /**
   * Calls `handler` with the A1 range (no sheet name) of each change on that sheet, ours included;
   * returns a function that stops it.
   */
  onChange(sheet: string, handler: (address: string) => void): Promise<() => Promise<void>>;
}

export type { SheetSnapshot };
