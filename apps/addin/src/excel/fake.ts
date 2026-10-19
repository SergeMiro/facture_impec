// An in-memory workbook behind the ExcelPort: the unit tests and the harness page (a sheet in the
// browser, no Excel) drive the same task pane code as Excel does.
import { columnIndex, columnLetters } from '@fi/core';
import type { ExcelPort, StatusPlan, UsedRange } from './port';
import { DETAIL_HEADER, STATUS_HEADER } from './reader';
import { planValues } from './writer';

export interface FakeCell {
  value: string | number | boolean;
  text: string;
  format?: string;
  fill?: string;
  bold?: boolean;
}

type Listener = () => void;

export class FakeWorkbook implements ExcelPort {
  /** sheet → "C4" → cell */
  readonly sheets = new Map<string, Map<string, FakeCell>>();
  readonly settings = new Map<string, string>();
  active: { sheet: string; cell: string };
  /** Calls to writeStatus, for the throttle tests. */
  writes = 0;
  /** Bumped on every change: the harness grid's snapshot for useSyncExternalStore. */
  version = 0;
  #changeHandlers = new Map<string, Set<(address: string) => void>>();
  #listeners = new Set<Listener>();

  constructor(sheets: Record<string, Record<string, FakeCell | string | number>>) {
    for (const [name, cells] of Object.entries(sheets)) {
      const map = new Map<string, FakeCell>();
      for (const [address, cell] of Object.entries(cells)) map.set(address, toCell(cell));
      this.sheets.set(name, map);
    }
    const first = Object.keys(sheets)[0] ?? 'Feuil1';
    this.active = { sheet: first, cell: 'A1' };
  }

  /** The harness re-renders on every change. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    this.version++;
    for (const l of this.#listeners) l();
  }

  cell(sheet: string, address: string): FakeCell | undefined {
    return this.sheets.get(sheet)?.get(address);
  }

  /** What a user typing into a cell does: the change event fires. */
  type(sheet: string, address: string, input: string | number): void {
    const cells = this.sheets.get(sheet);
    if (!cells) throw new Error(`No sheet ${sheet}`);
    const previous = cells.get(address);
    if (input === '') cells.delete(address);
    else cells.set(address, { ...toCell(input), ...(previous?.fill && { fill: previous.fill }) });
    this.#notify();
    for (const h of this.#changeHandlers.get(sheet) ?? []) h(address);
  }

  async activeSheet() {
    return this.active.sheet;
  }

  async sheetNames() {
    return [...this.sheets.keys()];
  }

  async activeCell() {
    const row = Number(/\d+$/.exec(this.active.cell)?.[0] ?? 1);
    return { sheet: this.active.sheet, row };
  }

  async usedRange(sheet: string): Promise<UsedRange | null> {
    const cells = this.sheets.get(sheet);
    if (!cells) throw Object.assign(new Error(`No sheet ${sheet}`), { code: 'ItemNotFound' });
    const used = [...cells.entries()].filter(([, c]) => c.text !== '' || c.value !== '');
    if (used.length === 0) return null;
    const coords = used.map(([a]) => split(a));
    const minCol = Math.min(...coords.map((c) => c.col));
    const maxCol = Math.max(...coords.map((c) => c.col));
    const minRow = Math.min(...coords.map((c) => c.row));
    const maxRow = Math.max(...coords.map((c) => c.row));
    const grid = <T>(pick: (c: FakeCell | undefined) => T) =>
      Array.from({ length: maxRow - minRow + 1 }, (_, r) =>
        Array.from({ length: maxCol - minCol + 1 }, (_, c) =>
          pick(cells.get(`${columnLetters(minCol + c)}${minRow + r}`)),
        ),
      );
    return {
      address: `${sheet}!${columnLetters(minCol)}${minRow}:${columnLetters(maxCol)}${maxRow}`,
      values: grid((c) => c?.value ?? ''),
      text: grid((c) => c?.text ?? ''),
      numberFormat: grid((c) => c?.format ?? 'General'),
    };
  }

  async select(sheet: string, cell: string) {
    if (!this.sheets.has(sheet)) {
      throw Object.assign(new Error(`No sheet ${sheet}`), { code: 'ItemNotFound' });
    }
    this.active = { sheet, cell };
    this.#notify();
  }

  async writeStatus(plans: StatusPlan[]) {
    this.writes++;
    for (const plan of plans) {
      const cells = this.sheets.get(plan.sheet);
      if (!cells) continue;
      const { first, status, detail, fills } = planValues(plan);
      cells.set(`${plan.statusCol}${plan.headerRow}`, { ...toCell(STATUS_HEADER), bold: true });
      cells.set(`${plan.detailCol}${plan.headerRow}`, { ...toCell(DETAIL_HEADER), bold: true });
      status.forEach(([text], i) => {
        const row = first + i;
        setText(cells, `${plan.statusCol}${row}`, text ?? '');
        setText(cells, `${plan.detailCol}${row}`, detail[i]?.[0] ?? '');
      });
      for (const f of fills) {
        for (let row = f.from; row <= f.to; row++) {
          const cell = cells.get(`${plan.statusCol}${row}`);
          if (cell) cell.fill = f.color;
        }
      }
      // Our own writes fire the change event too, as in Excel (docs/OFFICE.md §5).
      for (const h of this.#changeHandlers.get(plan.sheet) ?? []) {
        h(`${plan.statusCol}${plan.headerRow}:${plan.detailCol}${plan.lastRow}`);
      }
    }
    this.#notify();
  }

  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string | null) {
    if (value === null) this.settings.delete(key);
    else this.settings.set(key, value);
  }

  async onChange(sheet: string, handler: (address: string) => void) {
    const set = this.#changeHandlers.get(sheet) ?? new Set();
    set.add(handler);
    this.#changeHandlers.set(sheet, set);
    return async () => {
      set.delete(handler);
    };
  }
}

function toCell(input: FakeCell | string | number): FakeCell {
  if (typeof input === 'object') return input;
  return { value: input, text: String(input) };
}

function setText(cells: Map<string, FakeCell>, address: string, text: string) {
  if (text === '') cells.delete(address);
  else cells.set(address, { value: text, text });
}

function split(address: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(address);
  if (!m?.[1] || !m[2]) throw new Error(`Bad address ${address}`);
  return { col: columnIndex(m[1]), row: Number(m[2]) };
}
