// MappingAgent (plan §6): which column holds which invoice field. The model sees the first rows,
// pseudonymized, plus what the header dictionary found; guardrails then check every column it names.
// Without AI, or when the call fails, the dictionary's answer is used and the UI says so.
import {
  CONFIRM_BELOW,
  ColumnLetters,
  detectGrouping,
  detectMapping,
  discountWarnings,
  type FieldMapping,
  headerScore,
  INVOICE_FIELDS,
  type InvoiceField,
  isBlank,
  missingFieldWarnings,
  normalizeHeader,
  notAnAmount,
  type SheetMapping,
  type SheetSnapshot,
} from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { AiHandle } from './ai';
import { callStructured, estimateTokens, promptHash, readPrompt } from './llm';
import { maskSnapshot } from './masking';
import type { Orchestrator, SkipReason } from './orchestrator';
import { Pseudonymizer } from './pseudonymize';

/** What the model answers. Loose on purpose (strict structured-output modes refuse bounds); the guardrails check. */
export const MappingAnswer = z.object({
  headerRow: z.number(),
  mapping: z.array(z.object({ field: z.string(), column: z.string(), confidence: z.number() })),
  groupingColumn: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type MappingAnswer = z.infer<typeof MappingAnswer>;

const SYSTEM = readPrompt('mapping.md');
const TOOL_DESCRIPTION =
  'Shows up to 15 distinct values of one column below a header row, with counts of numbers and dates.';
export const MAPPING_PROMPT_HASH = promptHash(SYSTEM, MappingAnswer, [TOOL_DESCRIPTION]);

const PROMPT_ROWS = 50;
const MAX_ROWS = 2000;
const CELL_CHARS = 60;
const MAX_WARNINGS = 5;

export type Degraded = SkipReason | 'error';

export interface MappingResult {
  mapping: SheetMapping;
  /** Why the dictionary answered instead of the agent; null when the agent did. */
  degraded: Degraded | null;
}

export interface MappingContext {
  tenantId: string;
  ai: AiHandle | null;
  orchestrator: Orchestrator;
  locale?: string;
  signal?: AbortSignal;
}

const clip = (s: string) => (s.length > CELL_CHARS ? `${s.slice(0, CELL_CHARS)}…` : s);

/** The user message: sheet, field list, the dictionary's hint and the first rows. */
export function mappingPrompt(masked: SheetSnapshot, hint: SheetMapping, locale: string): string {
  const rows = masked.rows
    .filter((r) => r.cells.some((c) => !isBlank(c)))
    .slice(0, PROMPT_ROWS)
    .map((r) => ({
      row: r.row,
      cells: Object.fromEntries(
        r.cells.filter((c) => !isBlank(c)).map((c) => [c.col, clip(c.text)]),
      ),
    }));
  return JSON.stringify({
    sheet: masked.sheet,
    locale,
    fields: INVOICE_FIELDS.map((f) => ({ field: f, label: t(`sheet.field.${f}`) })),
    hint: {
      headerRow: hint.headerRow,
      mapping: Object.entries(hint.mapping).map(([field, m]) => ({
        field,
        column: m?.column,
        confidence: m?.confidence,
      })),
    },
    rows,
  });
}

function sampleTool(masked: SheetSnapshot) {
  return tool({
    description: TOOL_DESCRIPTION,
    inputSchema: z.object({ column: z.string(), headerRow: z.number() }),
    execute: async ({ column, headerRow }) => {
      const col = column.trim().toUpperCase();
      const cells = masked.rows
        .filter((r) => r.row > headerRow)
        .map((r) => r.cells.find((c) => c.col === col))
        .filter((c) => c !== undefined && !isBlank(c));
      const distinct = [...new Set(cells.map((c) => clip(c?.text ?? '')))];
      return {
        column: col,
        filled: cells.length,
        distinct: distinct.length,
        numbers: cells.filter((c) => typeof c?.value === 'number').length,
        dates: cells.filter((c) => /date|[dmy]{2}/i.test(c?.format ?? '')).length,
        examples: distinct.slice(0, 15),
      };
    },
  });
}

const headerText = (snapshot: SheetSnapshot, row: number, col: string) =>
  snapshot.rows.find((r) => r.row === row)?.cells.find((c) => c.col === col)?.text ?? '';

const columnBelow = (snapshot: SheetSnapshot, row: number, col: string) =>
  snapshot.rows.filter((r) => r.row > row).flatMap((r) => r.cells.filter((c) => c.col === col));

const SIREN_HEADER = /\b(siren|siret|n d entreprise|numero d entreprise|identifiant entreprise)\b/;

/**
 * Turns the model's answer into a SheetMapping the rest of the code can trust: known fields, real
 * columns, one column per field, no SIREN without a SIREN header, confidence below 0.8 flagged.
 * Strong dictionary matches the model left out are kept.
 */
export function guardMapping(
  answer: MappingAnswer,
  snapshot: SheetSnapshot,
  hint: SheetMapping,
  p: Pseudonymizer,
): SheetMapping {
  const notes: string[] = [];
  const rowNumbers = new Set(snapshot.rows.map((r) => r.row));
  const headerRow =
    Number.isInteger(answer.headerRow) && rowNumbers.has(answer.headerRow)
      ? answer.headerRow
      : hint.headerRow;
  const columns = new Set(
    snapshot.rows
      .filter((r) => r.row >= headerRow)
      .flatMap((r) => r.cells.filter((c) => !isBlank(c)).map((c) => c.col)),
  );
  const fields = new Set<string>(INVOICE_FIELDS);

  const proposals = answer.mapping
    .map((m) => ({
      field: m.field as InvoiceField,
      column: m.column.trim().toUpperCase(),
      confidence: Math.min(1, Math.max(0, Number.isFinite(m.confidence) ? m.confidence : 0)),
    }))
    .filter((m) => fields.has(m.field) && ColumnLetters.safeParse(m.column).success)
    .filter((m) => columns.has(m.column))
    .filter((m) => {
      if (m.field !== 'buyerSiren' && m.field !== 'buyerSiret') return true;
      const header = headerText(snapshot, headerRow, m.column);
      const ok = SIREN_HEADER.test(normalizeHeader(header)) || headerScore(header, m.field) > 0;
      if (!ok) notes.push(t('mapping.warning.sirenDropped', { column: m.column }));
      return ok;
    })
    .filter((m) => {
      // A percentage is not the amount BT-136 takes: a rule decides that, not the model.
      if (m.field !== 'lineDiscount') return true;
      const header = headerText(snapshot, headerRow, m.column);
      const ok = !notAnAmount(header, columnBelow(snapshot, headerRow, m.column));
      if (!ok) notes.push(t('sheet.warning.discountPercent', { column: m.column }));
      return ok;
    })
    .sort((a, b) => b.confidence - a.confidence);

  const mapping: Partial<Record<InvoiceField, FieldMapping>> = {};
  const used = new Set<string>();
  const take = (field: InvoiceField, column: string, confidence: number) => {
    if (mapping[field] || used.has(column)) return;
    mapping[field] = { column, confidence, needsConfirmation: confidence < CONFIRM_BELOW };
    used.add(column);
  };
  for (const m of proposals) take(m.field, m.column, m.confidence);
  if (headerRow === hint.headerRow) {
    for (const [field, m] of Object.entries(hint.mapping) as [InvoiceField, FieldMapping][])
      if (m.confidence >= 0.85) take(field, m.column, m.confidence);
  }

  const grouping =
    detectGrouping(snapshot, headerRow, mapping.number?.column) ??
    (answer.groupingColumn && columns.has(answer.groupingColumn.trim().toUpperCase())
      ? { by: answer.groupingColumn.trim().toUpperCase() }
      : null);

  const own = answer.warnings
    .map((w) => p.unmask(w))
    .filter((w) => w.unknown.length === 0 && w.text.trim() !== '')
    .map((w) => w.text.trim().slice(0, 300))
    .slice(0, MAX_WARNINGS);

  return {
    sheet: snapshot.sheet,
    headerRow,
    mapping,
    grouping,
    warnings: [
      ...new Set([
        ...missingFieldWarnings(mapping),
        ...notes,
        ...discountWarnings(snapshot, headerRow, mapping),
        ...own,
      ]),
    ],
    source: 'agent',
  };
}

const degradedNote = (reason: Degraded) => t(`mapping.degraded.${reason}` as MessageKey);

/** Proposes a mapping for a sheet: the agent when AI is on and answers, the dictionary otherwise. */
export async function proposeMapping(
  snapshot: SheetSnapshot,
  ctx: MappingContext,
): Promise<MappingResult> {
  const limited = { ...snapshot, rows: snapshot.rows.slice(0, MAX_ROWS) };
  const hint = detectMapping(limited);
  const fallback = (reason: Degraded): MappingResult => ({
    mapping: { ...hint, warnings: [degradedNote(reason), ...hint.warnings] },
    degraded: reason,
  });
  const { ai } = ctx;
  if (!ai) return fallback('ai_off');

  const p = new Pseudonymizer();
  const masked = maskSnapshot(p, limited, hint);
  const prompt = mappingPrompt(masked, hint, ctx.locale ?? 'fr-FR');
  const outcome = await ctx.orchestrator.run({
    tenantId: ctx.tenantId,
    phase: 'detect',
    provider: ai.provider,
    model: ai.modelId('classify'),
    promptHash: MAPPING_PROMPT_HASH,
    estimatedTokens: estimateTokens(SYSTEM, prompt),
    ...(ctx.signal && { signal: ctx.signal }),
    call: (signal) =>
      callStructured({
        model: ai.model('classify'),
        system: SYSTEM,
        prompt,
        schema: MappingAnswer,
        schemaName: 'sheet_mapping',
        ...(ai.tools && { tools: { sampleColumn: sampleTool(masked) }, maxSteps: 4 }),
        maxOutputTokens: 2000,
        signal,
      }),
  });
  if (!outcome.ok) return fallback(outcome.reason);
  return { mapping: guardMapping(outcome.output, limited, hint, p), degraded: null };
}
