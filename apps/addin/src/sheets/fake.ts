// Native Google service stand-in for host tests and the browser harness. Never shipped.
import { columnIndex, columnLetters } from '@fi/core';
import type { FakeCell, FakeWorkbook } from '../excel/fake';
import {
  createSheetsHost,
  type GoogleBook,
  type GoogleRange,
  type GoogleSheet,
  type SheetsServices,
} from './host';

export function fakeGoogleSheets(workbook: FakeWorkbook, id = 'spreadsheet-fi-test') {
  const properties = new Map<string, string>();
  const hidden = new Set<string>();
  const dates = new Map<string, Date>();
  let zone = 'Europe/Paris';
  let maxColumns = 26;
  let locked = false;
  let flushes = 0;
  const nativeSheets = new Map<string, GoogleSheet>();
  const coord = (address: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    if (!match?.[1] || !match[2]) throw new Error('bad cell address');
    return { row: Number(match[2]), col: columnIndex(match[1]) };
  };
  const notify = () => {
    void workbook.select(workbook.active.sheet, workbook.active.cell);
  };
  const rangeOf = (
    sheet: GoogleSheet,
    row: number,
    col: number,
    rows = 1,
    cols = 1,
  ): GoogleRange => {
    const name = sheet.getName();
    const cells = workbook.sheets.get(name);
    if (!cells) throw new Error('no sheet');
    const addresses = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => `${columnLetters(col + c)}${row + r}`),
    );
    const top = addresses[0]?.[0] ?? '';
    const values = <T>(fn: (cell: FakeCell | undefined, address: string) => T) =>
      addresses.map((r) => r.map((a) => fn(cells.get(a), a)));
    const update = (fn: (cell: FakeCell, r: number, c: number) => FakeCell) => {
      addresses.forEach((line, r) => {
        line.forEach((address, c) => {
          cells.set(address, fn(cells.get(address) ?? { value: '', text: '' }, r, c));
        });
      });
      notify();
      return range;
    };
    const range: GoogleRange = {
      getValues: () => values((cell, a) => dates.get(`${name}!${a}`) ?? cell?.value ?? ''),
      getDisplayValues: () => values((cell) => cell?.text ?? ''),
      getNumberFormats: () => values((cell) => cell?.format ?? 'General'),
      getFormulas: () => values((cell) => cell?.formula ?? ''),
      getValue: () => dates.get(`${name}!${top}`) ?? cells.get(top)?.value ?? '',
      getDisplayValue: () => cells.get(top)?.text ?? '',
      getFormula: () => cells.get(top)?.formula ?? '',
      getRow: () => row,
      getSheet: () => sheet,
      setValue: (value) =>
        update((cell) => {
          const { formula: _formula, ...previous } = cell;
          return { ...previous, value, text: String(value) };
        }),
      setValues: (grid) =>
        update((cell, r, c) => {
          const { formula: _formula, ...previous } = cell;
          const value = grid[r]?.[c] ?? '';
          return { ...previous, value, text: value };
        }),
      setNumberFormat: (format) => update((cell) => ({ ...cell, format })),
      setFontWeight: (weight) => update((cell) => ({ ...cell, bold: weight === 'bold' })),
      setBackground: (color) => update((cell) => ({ ...cell, fill: color ?? undefined })),
      activate: () => {
        void workbook.select(name, top);
        return range;
      },
    };
    return range;
  };
  for (const [name, cells] of workbook.sheets) {
    const used = () => [...cells.entries()].filter(([, c]) => c.value !== '' || c.text !== '');
    const sheet: GoogleSheet = {
      getName: () => name,
      getSheetId: () => [...workbook.sheets.keys()].indexOf(name) + 1,
      isSheetHidden: () => hidden.has(name),
      getLastRow: () => Math.max(0, ...used().map(([a]) => coord(a).row)),
      getLastColumn: () => Math.max(0, ...used().map(([a]) => coord(a).col)),
      getMaxColumns: () => maxColumns,
      insertColumnsAfter: (_after, count) => {
        maxColumns += count;
        return sheet;
      },
      getRange: ((first: string | number, col?: number, rows?: number, cols?: number) => {
        if (typeof first === 'number') return rangeOf(sheet, first, col ?? 1, rows, cols);
        const at = coord(first);
        return rangeOf(sheet, at.row, at.col);
      }) as GoogleSheet['getRange'],
    };
    nativeSheets.set(name, sheet);
  }
  const sheetOf = (name: string) => {
    const sheet = nativeSheets.get(name);
    if (!sheet || !workbook.sheets.has(name)) return null;
    return sheet;
  };
  const book: GoogleBook = {
    getId: () => id,
    getSpreadsheetTimeZone: () => zone,
    getActiveSheet: () => sheetOf(workbook.active.sheet) as GoogleSheet,
    getSheets: () => [...nativeSheets.values()].filter((s) => workbook.sheets.has(s.getName())),
    getSheetByName: sheetOf,
    getActiveRange: () => sheetOf(workbook.active.sheet)?.getRange(workbook.active.cell) ?? null,
    setActiveSheet: (sheet) => {
      void workbook.select(sheet.getName(), 'A1');
      return sheet;
    },
  };
  const services: SheetsServices = {
    book,
    properties: {
      getProperty: (key) => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: (key) => properties.delete(key),
    },
    lock: {
      waitLock() {
        if (locked) throw new Error('already locked');
        locked = true;
      },
      releaseLock() {
        locked = false;
      },
    },
    formatDate(date, timeZone) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const part = (type: string) => parts.find((p) => p.type === type)?.value;
      return `${part('year')}-${part('month')}-${part('day')}`;
    },
    uuid: () => crypto.randomUUID(),
    flush: () => {
      flushes++;
    },
  };
  const host = createSheetsHost(services);
  for (const sheet of nativeSheets.values())
    void workbook.onChange(sheet.getName(), () => host.recordEdit(sheet.getSheetId()));
  return {
    host,
    services,
    workbook,
    properties,
    hidden,
    dates,
    setTimeZone(value: string) {
      zone = value;
    },
    get locked() {
      return locked;
    },
    get flushes() {
      return flushes;
    },
  };
}
