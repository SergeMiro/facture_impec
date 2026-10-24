// The only operations the hosted pane can ask of its bound Google spreadsheet (R9).
import { z } from 'zod';

export const sheetName = z.string().min(1).max(100);
const cell = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/);
const value = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const CellContentSchema = z.object({
  value,
  text: z.string(),
  formula: z.string().nullable(),
});
export const UsedRangeSchema = z
  .object({
    address: z.string(),
    values: z.array(z.array(value)),
    text: z.array(z.array(z.string())),
    numberFormat: z.array(z.array(z.string())),
    formulas: z.array(z.array(z.string())),
  })
  .nullable();
export const StatusPlanSchema = z
  .object({
    sheet: sheetName,
    headerRow: z.number().int().min(1).max(5_000),
    statusCol: z.string().regex(/^[A-Z]{1,3}$/),
    detailCol: z.string().regex(/^[A-Z]{1,3}$/),
    lastRow: z.number().int().min(1).max(5_000),
    cells: z
      .array(
        z.object({
          row: z.number().int().min(1).max(5_000),
          status: z.string().max(20_000),
          detail: z.string().max(20_000),
          tone: z.enum(['ok', 'warning', 'error', 'progress', 'neutral']),
        }),
      )
      .max(5_000),
  })
  .refine(
    (p) =>
      p.statusCol !== p.detailCol &&
      p.lastRow >= p.headerRow &&
      p.cells.every((c) => c.row > p.headerRow && c.row <= p.lastRow),
  );
const settingKey = z
  .string()
  .max(180)
  .refine((k) => k === 'fi.workbookId' || k === 'fi.testMode' || k.startsWith('fi.mapping:'));

export const SheetsRequest = z.discriminatedUnion('method', [
  z.object({ method: z.literal('activeSheet') }),
  z.object({ method: z.literal('sheetNames') }),
  z.object({ method: z.literal('activeCell') }),
  z.object({ method: z.literal('usedRange'), sheet: sheetName }),
  z.object({ method: z.literal('select'), sheet: sheetName, cell }),
  z.object({ method: z.literal('readCell'), sheet: sheetName, cell }),
  z.object({
    method: z.literal('writeCell'),
    sheet: sheetName,
    cell,
    value: z.number().finite(),
    expected: CellContentSchema,
  }),
  z.object({ method: z.literal('writeStatus'), plans: z.array(StatusPlanSchema).max(50) }),
  z.object({ method: z.literal('getSetting'), key: settingKey }),
  z.object({
    method: z.literal('setSetting'),
    key: settingKey,
    value: z.string().max(8_000).nullable(),
  }),
  z.object({ method: z.literal('changes'), sheets: z.array(sheetName).max(50) }),
]);
export type SheetsRequest = z.infer<typeof SheetsRequest>;
export const SheetsResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'InvalidArgument',
      'ItemNotFound',
      'TooManyRows',
      'TooManyCells',
      'CellChanged',
      'OwnedColumnsConflict',
      'Unavailable',
    ]),
  }),
]);
export type SheetsResult = z.infer<typeof SheetsResult>;
export type SheetsCode = Extract<SheetsResult, { ok: false }>['code'];
export const RequestMessage = z.object({
  type: z.literal('fi.sheets.request'),
  channel: z.string().uuid(),
  id: z.string().uuid(),
  request: SheetsRequest,
});
export const ResponseMessage = z.object({
  type: z.literal('fi.sheets.response'),
  channel: z.string().uuid(),
  id: z.string().uuid(),
  result: SheetsResult,
});
