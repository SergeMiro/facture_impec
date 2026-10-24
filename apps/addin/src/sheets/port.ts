// The same spreadsheet contract as Excel, over the validated Apps Script RPC (R9).
import { type MessageKey, t } from '@fi/shared';
import { z } from 'zod';
import { type CellContent, type ExcelPort, SpreadsheetError } from '../excel/port';
import {
  CellContentSchema,
  type SheetsCode,
  type SheetsRequest,
  SheetsResult,
  sheetName,
  UsedRangeSchema,
} from './protocol';

const ERROR: Record<SheetsCode, MessageKey> = {
  InvalidArgument: 'sheets.error.invalid',
  ItemNotFound: 'sheets.error.missing',
  TooManyRows: 'sheets.error.rows',
  TooManyCells: 'sheets.error.cells',
  CellChanged: 'sheets.error.changed',
  OwnedColumnsConflict: 'sheets.error.columns',
  Unavailable: 'sheets.error.unavailable',
};
export type SheetsTransport = (request: SheetsRequest) => Promise<unknown>;
export interface SheetsPortOptions {
  pollMs?: number;
  reconcileMs?: number;
  onError?(error: SpreadsheetError): void;
}
export function googleSheetsPort(transport: SheetsTransport, options: SheetsPortOptions = {}) {
  const call = async <T>(request: SheetsRequest, schema: z.ZodType<T>): Promise<T> => {
    let raw: unknown;
    try {
      raw = await transport(request);
    } catch {
      throw new SpreadsheetError('Unavailable', t(ERROR.Unavailable));
    }
    const result = SheetsResult.safeParse(raw);
    if (!result.success) throw new SpreadsheetError('Unavailable', t(ERROR.Unavailable));
    if (!result.data.ok) throw new SpreadsheetError(result.data.code, t(ERROR[result.data.code]));
    const parsed = schema.safeParse(result.data.value);
    if (!parsed.success) throw new SpreadsheetError('Unavailable', t(ERROR.Unavailable));
    return parsed.data;
  };
  const nothing = z.null();
  const read = new Map<string, CellContent>();
  const watches = new Map<
    string,
    {
      revision: string | null;
      handlers: Set<(address: string) => void>;
      reconciledAt: number;
    }
  >();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const revisions = (sheets: string[]) =>
    call({ method: 'changes', sheets }, z.record(z.string(), z.string().nullable()));
  const schedule = () => {
    if (closed || timer !== null || !watches.size) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, options.pollMs ?? 5_000);
  };
  const tick = async () => {
    if (closed || !watches.size) return;
    try {
      const current = await revisions([...watches.keys()]);
      if (closed) return;
      for (const [sheet, watch] of watches) {
        const revision = current[sheet] ?? null;
        const reconcile = Date.now() - watch.reconciledAt >= (options.reconcileMs ?? 60_000);
        if (revision !== watch.revision || reconcile) {
          watch.revision = revision;
          watch.reconciledAt = Date.now();
          // A full-sheet signal merges every edit since the previous poll. Script/API edits do
          // not fire onEdit, so the periodic reconciliation also covers them and recalculations.
          for (const handler of watch.handlers) handler('A1');
        }
      }
    } catch (e) {
      if (!closed && e instanceof SpreadsheetError) options.onError?.(e);
    } finally {
      schedule();
    }
  };
  const port: ExcelPort & { close(): void } = {
    activeSheet: () => call({ method: 'activeSheet' }, sheetName),
    sheetNames: () => call({ method: 'sheetNames' }, z.array(sheetName)),
    activeCell: () =>
      call(
        { method: 'activeCell' },
        z.object({ sheet: sheetName, row: z.number().int().positive() }),
      ),
    usedRange: (sheet) => call({ method: 'usedRange', sheet }, UsedRangeSchema),
    select: async (sheet, cell) => {
      await call({ method: 'select', sheet, cell }, nothing);
    },
    readCell: async (sheet, cell) => {
      const content = await call({ method: 'readCell', sheet, cell }, CellContentSchema);
      read.set(JSON.stringify([sheet, cell]), content);
      return content;
    },
    writeCell: async (sheet, cell, value) => {
      const key = JSON.stringify([sheet, cell]);
      const expected = read.get(key) ?? (await port.readCell(sheet, cell));
      read.delete(key);
      await call(
        {
          method: 'writeCell',
          sheet,
          cell,
          value,
          expected: {
            value: CellContentSchema.shape.value.parse(expected.value),
            text: expected.text,
            formula: expected.formula,
          },
        },
        nothing,
      );
    },
    writeStatus: async (plans) => {
      await call({ method: 'writeStatus', plans }, nothing);
    },
    getSetting: (key) => call({ method: 'getSetting', key }, z.string().nullable()),
    setSetting: async (key, value) => {
      await call({ method: 'setSetting', key, value }, nothing);
    },
    async onChange(sheet, handler) {
      let watch = watches.get(sheet);
      if (!watch) {
        const initial = await revisions([sheet]);
        if (closed) return async () => {};
        watch = watches.get(sheet) ?? {
          revision: initial[sheet] ?? null,
          handlers: new Set(),
          reconciledAt: Date.now(),
        };
        watches.set(sheet, watch);
      }
      watch.handlers.add(handler);
      schedule();
      return async () => {
        watch.handlers.delete(handler);
        if (!watch.handlers.size && watches.get(sheet) === watch) watches.delete(sheet);
        if (!watches.size && timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };
    },
    close() {
      closed = true;
      watches.clear();
      read.clear();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
  return port;
}
