// The ExcelPort over Office.js (docs/OFFICE.md §5): named loads only, one sync per call, every
// Excel.run behind withRetry.
import { parseAddress } from '@fi/core';
import type { CellContent, ExcelPort, UsedRange } from './port';
import { DETAIL_HEADER, STATUS_HEADER } from './reader';
import { withRetry } from './retry';
import { planValues } from './writer';

const run = <T>(batch: (context: Excel.RequestContext) => Promise<T>) =>
  withRetry(() => Excel.run(batch));

function saveSettings(): Promise<void> {
  return new Promise((resolve, reject) => {
    Office.context.document.settings.saveAsync((result) =>
      result.status === Office.AsyncResultStatus.Succeeded
        ? resolve()
        : reject(result.error ?? new Error('settings.saveAsync failed')),
    );
  });
}

export function officeExcelPort(): ExcelPort {
  return {
    activeSheet: () =>
      run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        sheet.load('name');
        await context.sync();
        return sheet.name;
      }),

    sheetNames: () =>
      run(async (context) => {
        const sheets = context.workbook.worksheets;
        sheets.load('items/name, items/visibility');
        await context.sync();
        return sheets.items.filter((s) => s.visibility === 'Visible').map((s) => s.name);
      }),

    activeCell: () =>
      run(async (context) => {
        const cell = context.workbook.getActiveCell();
        cell.load('rowIndex');
        cell.worksheet.load('name');
        await context.sync();
        return { sheet: cell.worksheet.name, row: cell.rowIndex + 1 };
      }),

    usedRange: (sheet) =>
      run(async (context): Promise<UsedRange | null> => {
        const range = context.workbook.worksheets.getItem(sheet).getUsedRangeOrNullObject(true);
        range.load('address, values, text, numberFormat, formulas');
        await context.sync();
        if (range.isNullObject) return null;
        return {
          address: range.address,
          values: range.values,
          text: range.text,
          numberFormat: range.numberFormat,
          formulas: range.formulas,
        };
      }),

    select: (sheet, cell) =>
      run(async (context) => {
        const ws = context.workbook.worksheets.getItem(sheet);
        ws.activate();
        ws.getRange(cell).select();
        await context.sync();
      }),

    readCell: (sheet, cell) =>
      run(async (context): Promise<CellContent> => {
        const range = context.workbook.worksheets.getItem(sheet).getRange(cell);
        range.load('values, text, formulas');
        await context.sync();
        const formula: unknown = range.formulas[0]?.[0];
        return {
          value: range.values[0]?.[0] ?? '',
          text: range.text[0]?.[0] ?? '',
          formula: typeof formula === 'string' && formula.startsWith('=') ? formula : null,
        };
      }),

    writeCell: (sheet, cell, value) =>
      run(async (context) => {
        context.workbook.worksheets.getItem(sheet).getRange(cell).values = [[value]];
        await context.sync();
      }),

    writeStatus: (plans) =>
      run(async (context) => {
        for (const plan of plans) {
          const ws = context.workbook.worksheets.getItem(plan.sheet);
          const { first, status, detail, fills } = planValues(plan);
          for (const [col, header] of [
            [plan.statusCol, STATUS_HEADER],
            [plan.detailCol, DETAIL_HEADER],
          ] as const) {
            const cell = ws.getRange(`${col}${plan.headerRow}`);
            cell.values = [[header]];
            cell.format.font.bold = true;
          }
          if (status.length === 0) continue;
          const statusRange = ws.getRange(
            `${plan.statusCol}${first}:${plan.statusCol}${plan.lastRow}`,
          );
          statusRange.values = status;
          statusRange.format.fill.clear();
          ws.getRange(`${plan.detailCol}${first}:${plan.detailCol}${plan.lastRow}`).values = detail;
          for (const f of fills) {
            ws.getRange(`${plan.statusCol}${f.from}:${plan.statusCol}${f.to}`).format.fill.color =
              f.color;
          }
        }
        await context.sync();
      }),

    async getSetting(key) {
      const value: unknown = Office.context.document.settings.get(key);
      return typeof value === 'string' ? value : null;
    },

    async setSetting(key, value) {
      if (value === null) Office.context.document.settings.remove(key);
      else Office.context.document.settings.set(key, value);
      await saveSettings();
    },

    onChange: (sheet, handler) =>
      run(async (context) => {
        const registration = context.workbook.worksheets
          .getItem(sheet)
          .onChanged.add(async (event) =>
            handler(parseAddress(event.address)?.cell ?? event.address),
          );
        await context.sync();
        return () =>
          Excel.run(registration.context, async (ctx) => {
            registration.remove();
            await ctx.sync();
          });
      }),
  };
}
