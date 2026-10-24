// Apps Script adapter for the current spreadsheet. Google API contracts: docs/GOOGLE_SHEETS.md.
import { cellAddress, columnIndex } from '@fi/core';
import { t } from '@fi/shared';
import { DETAIL_HEADER, STATUS_HEADER } from '../excel/reader';
import { planValues } from '../excel/writer';
import { type SheetsCode, SheetsRequest, type SheetsResult } from './protocol';

export interface GoogleRange {
  getValues(): unknown[][];
  getDisplayValues(): string[][];
  getNumberFormats(): string[][];
  getFormulas(): string[][];
  getValue(): unknown;
  getDisplayValue(): string;
  getFormula(): string;
  getRow(): number;
  getSheet(): GoogleSheet;
  setValue(value: string | number): GoogleRange;
  setValues(values: string[][]): GoogleRange;
  setNumberFormat(format: string): GoogleRange;
  setFontWeight(weight: string): GoogleRange;
  setBackground(color: string | null): GoogleRange;
  activate(): GoogleRange;
}
export interface GoogleSheet {
  getName(): string;
  getSheetId(): number;
  isSheetHidden(): boolean;
  getLastRow(): number;
  getLastColumn(): number;
  getMaxColumns(): number;
  insertColumnsAfter(after: number, count: number): GoogleSheet;
  getRange(a1: string): GoogleRange;
  getRange(row: number, col: number, rows: number, cols: number): GoogleRange;
}
export interface GoogleBook {
  getId(): string;
  getSpreadsheetTimeZone(): string;
  getActiveSheet(): GoogleSheet;
  getSheets(): GoogleSheet[];
  getSheetByName(name: string): GoogleSheet | null;
  getActiveRange(): GoogleRange | null;
  setActiveSheet(sheet: GoogleSheet): GoogleSheet;
}
export interface GoogleProperties {
  getProperty(key: string): string | null;
  setProperty(key: string, value: string): unknown;
  deleteProperty(key: string): unknown;
}
export interface GoogleLock {
  waitLock(ms: number): void;
  releaseLock(): void;
}
export interface SheetsServices {
  book: GoogleBook;
  properties: GoogleProperties;
  lock: GoogleLock;
  formatDate(date: Date, zone: string, format: string): string;
  uuid(): string;
  flush(): void;
}

class HostError extends Error {
  constructor(readonly code: SheetsCode) {
    super(code);
  }
}
const MAX_ROWS = 5_000;
const MAX_CELLS = 250_000;

export function createSheetsHost(s: SheetsServices) {
  const sheetOf = (name: string) => {
    const sheet = s.book.getSheetByName(name);
    if (!sheet) throw new HostError('ItemNotFound');
    return sheet;
  };
  // Date objects cannot cross google.script.run. Use the spreadsheet's date, never UTC's day.
  const primitive = (value: unknown) =>
    value instanceof Date
      ? s.formatDate(value, s.book.getSpreadsheetTimeZone(), 'yyyy-MM-dd')
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : null;
  const content = (range: GoogleRange) => ({
    value: primitive(range.getValue()),
    text: range.getDisplayValue(),
    formula: range.getFormula() || null,
  });
  const locked = <T>(fn: () => T): T => {
    s.lock.waitLock(5_000);
    try {
      const result = fn();
      s.flush();
      return result;
    } finally {
      s.lock.releaseLock();
    }
  };
  const usedRange = (name: string) => {
    const sheet = sheetOf(name);
    const rows = sheet.getLastRow();
    const cols = sheet.getLastColumn();
    if (!rows || !cols) return null;
    if (rows > MAX_ROWS) throw new HostError('TooManyRows');
    if (rows * cols > MAX_CELLS) throw new HostError('TooManyCells');
    const range = sheet.getRange(1, 1, rows, cols);
    return {
      address: cellAddress(name, 'A', 1),
      values: range.getValues().map((row) => row.map(primitive)),
      text: range.getDisplayValues(),
      numberFormat: range.getNumberFormats(),
      formulas: range.getFormulas(),
    };
  };
  const run = (request: SheetsRequest): unknown => {
    switch (request.method) {
      case 'activeSheet':
        return s.book.getActiveSheet().getName();
      case 'sheetNames':
        return s.book
          .getSheets()
          .filter((sheet) => !sheet.isSheetHidden())
          .map((sheet) => sheet.getName());
      case 'activeCell': {
        const range = s.book.getActiveRange();
        return {
          sheet: range?.getSheet().getName() ?? s.book.getActiveSheet().getName(),
          row: range?.getRow() ?? 1,
        };
      }
      case 'usedRange':
        return usedRange(request.sheet);
      case 'select': {
        const sheet = sheetOf(request.sheet);
        s.book.setActiveSheet(sheet);
        sheet.getRange(request.cell).activate();
        return null;
      }
      case 'readCell':
        return content(sheetOf(request.sheet).getRange(request.cell));
      case 'writeCell':
        return locked(() => {
          const range = sheetOf(request.sheet).getRange(request.cell);
          const current = content(range);
          if (
            current.formula ||
            current.value !== request.expected.value ||
            request.expected.formula
          ) {
            throw new HostError('CellChanged');
          }
          range.setValue(request.value);
          return null;
        });
      case 'writeStatus':
        return locked(() => {
          // Preflight every target before writing. A user may have filled the proposed columns since
          // the read. Only our existing headers or entirely empty columns are ours to write.
          for (const plan of request.plans) {
            const sheet = sheetOf(plan.sheet);
            for (const [col, header] of [
              [plan.statusCol, STATUS_HEADER],
              [plan.detailCol, DETAIL_HEADER],
            ] as const) {
              const index = columnIndex(col);
              if (index > sheet.getMaxColumns()) continue;
              const range = sheet.getRange(
                plan.headerRow,
                index,
                plan.lastRow - plan.headerRow + 1,
                1,
              );
              const values = range.getValues();
              if (
                values[0]?.[0] !== header &&
                values.some((row) => row.some((v) => v !== '' && v !== null))
              ) {
                throw new HostError('OwnedColumnsConflict');
              }
            }
          }
          for (const plan of request.plans) {
            const sheet = sheetOf(plan.sheet);
            const needed = Math.max(columnIndex(plan.statusCol), columnIndex(plan.detailCol));
            if (needed > sheet.getMaxColumns())
              sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
            const { first, status, detail, fills } = planValues(plan);
            for (const [col, header] of [
              [plan.statusCol, STATUS_HEADER],
              [plan.detailCol, DETAIL_HEADER],
            ] as const) {
              sheet.getRange(`${col}${plan.headerRow}`).setValue(header).setFontWeight('bold');
            }
            if (!status.length) continue;
            sheet
              .getRange(first, columnIndex(plan.statusCol), status.length, 1)
              .setNumberFormat('@')
              .setValues(status)
              .setBackground(null);
            sheet
              .getRange(first, columnIndex(plan.detailCol), detail.length, 1)
              .setNumberFormat('@')
              .setValues(detail);
            for (const fill of fills)
              sheet
                .getRange(fill.from, columnIndex(plan.statusCol), fill.to - fill.from + 1, 1)
                .setBackground(fill.color);
          }
          return null;
        });
      case 'getSetting':
        return request.key === 'fi.workbookId'
          ? `gs-${s.book.getId()}`
          : s.properties.getProperty(request.key);
      case 'setSetting':
        return locked(() => {
          if (request.key === 'fi.workbookId') {
            if (request.value !== `gs-${s.book.getId()}`) throw new HostError('InvalidArgument');
          } else if (request.value === null) s.properties.deleteProperty(request.key);
          else s.properties.setProperty(request.key, request.value);
          return null;
        });
      case 'changes':
        return Object.fromEntries(
          request.sheets.map((name) => {
            const sheet = s.book.getSheetByName(name);
            return [
              name,
              sheet ? s.properties.getProperty(`fi.revision:${sheet.getSheetId()}`) : 'missing',
            ];
          }),
        );
    }
  };
  return {
    dispatch(raw: unknown): SheetsResult {
      const parsed = SheetsRequest.safeParse(raw);
      if (!parsed.success) return { ok: false, code: 'InvalidArgument' };
      try {
        return { ok: true, value: run(parsed.data) };
      } catch (e) {
        return { ok: false, code: e instanceof HostError ? e.code : 'Unavailable' };
      }
    },
    recordEdit(sheetId: number) {
      s.properties.setProperty(`fi.revision:${sheetId}`, s.uuid());
    },
  };
}

// Narrow descriptions of the native services; no third-party Apps Script types are required.
interface Menu {
  addItem(label: string, handler: string): Menu;
  addToUi(): void;
}
interface HtmlOutput {
  setTitle(title: string): HtmlOutput;
}
interface HtmlTemplate {
  config: string;
  evaluate(): HtmlOutput;
}
declare const SpreadsheetApp: {
  getActiveSpreadsheet(): GoogleBook;
  getUi(): { createMenu(label: string): Menu; showSidebar(html: HtmlOutput): void };
  flush(): void;
};
declare const PropertiesService: { getDocumentProperties(): GoogleProperties };
declare const LockService: { getDocumentLock(): GoogleLock };
declare const Utilities: { formatDate: SheetsServices['formatDate']; getUuid(): string };
declare const HtmlService: { createTemplateFromFile(name: string): HtmlTemplate };
declare const FI_SHEETS_URL: string;

function native() {
  return createSheetsHost({
    book: SpreadsheetApp.getActiveSpreadsheet(),
    properties: PropertiesService.getDocumentProperties(),
    lock: LockService.getDocumentLock(),
    formatDate: (date, zone, format) => Utilities.formatDate(date, zone, format),
    uuid: () => Utilities.getUuid(),
    flush: () => SpreadsheetApp.flush(),
  });
}
export const dispatch = (request: unknown) => native().dispatch(request);
export function recordEdit(event: { range?: GoogleRange } | undefined) {
  if (event?.range) native().recordEdit(event.range.getSheet().getSheetId());
}
export function menu() {
  SpreadsheetApp.getUi()
    .createMenu(t('app.title'))
    .addItem(t('sheets.menu.open'), 'fiOpen')
    .addToUi();
}
export function open() {
  const template = HtmlService.createTemplateFromFile('Sidebar');
  template.config = JSON.stringify({
    url: FI_SHEETS_URL,
    title: t('app.title'),
    failure: t('sheets.error.unavailable'),
  }).replace(/</g, '\\u003c');
  SpreadsheetApp.getUi().showSidebar(template.evaluate().setTitle(t('app.title')));
}
