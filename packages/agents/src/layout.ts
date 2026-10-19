// LayoutAgent (R1): what kind of document one of the company's other sheets lists (orders, delivery
// notes, purchases, a price list) and which column holds what. An extension of MappingAgent: the same
// masking, orchestrator, budget and column tool, its own prompt and guardrails. The API calls it only
// for headers the company never confirmed (apps/api/src/sources.ts looks the profiles up first).
// Without AI, or when the call fails, the dictionary answers and the pane says so.
import {
  CONFIRM_BELOW,
  ColumnLetters,
  detectLayout,
  type FieldMapping,
  fieldAllowed,
  isBlank,
  LAYOUT_FIELDS,
  LAYOUT_KINDS,
  type LayoutField,
  type LayoutKind,
  type LayoutMapping,
  layoutHeaderScore,
  layoutWarnings,
  normalizeHeader,
  type SheetSnapshot,
} from '@fi/core';
import { t } from '@fi/shared';
import { z } from 'zod';
import { callStructured, estimateTokens, promptHash, readPrompt } from './llm';
import {
  clip,
  type Degraded,
  degradedNote,
  headerText,
  type MappingContext,
  SIREN_HEADER,
  sampleTool,
  TOOL_DESCRIPTION,
} from './mapping';
import { maskSnapshot, personalHeader } from './masking';
import { Pseudonymizer } from './pseudonymize';

/** What the model answers. Loose on purpose, like MappingAnswer: the guardrails check. */
export const LayoutAnswer = z.object({
  kind: z.string(),
  kindConfidence: z.number(),
  headerRow: z.number(),
  mapping: z.array(z.object({ field: z.string(), column: z.string(), confidence: z.number() })),
  warnings: z.array(z.string()),
});
export type LayoutAnswer = z.infer<typeof LayoutAnswer>;

const SYSTEM = readPrompt('layout.md');
export const LAYOUT_PROMPT_HASH = promptHash(SYSTEM, LayoutAnswer, [TOOL_DESCRIPTION]);

/** The headers and about twenty rows below them (title rows included). */
const PROMPT_ROWS = 25;
const MAX_ROWS = 2000;
const MAX_WARNINGS = 5;

export interface LayoutResult {
  layout: LayoutMapping;
  /** Why the dictionary answered instead of the agent; null when the agent did. */
  degraded: Degraded | null;
}

/** The user message: sheet, kinds, fields, the dictionary's hint and the first rows. */
export function layoutPrompt(masked: SheetSnapshot, hint: LayoutMapping, locale: string): string {
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
    kinds: LAYOUT_KINDS.map((k) => ({ kind: k, label: t(`layout.kind.${k}`) })),
    fields: LAYOUT_FIELDS.map((f) => ({ field: f, label: t(`layout.field.${f}`) })),
    hint: {
      kind: hint.kind,
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

/** The personal columns of the hint, named as the masking knows them. */
const personalColumns = (hint: LayoutMapping) => ({
  headerRow: hint.headerRow,
  mapping: {
    ...(hint.mapping.partyName && { buyerName: hint.mapping.partyName }),
    ...(hint.mapping.partySiren && { buyerSiren: hint.mapping.partySiren }),
  },
});

/** A supplier's name column (« Fournisseur », « Frs »), but not the supplier's article reference. */
const SUPPLIER_HEADER = /\b(fournisseur|fourn|frs|supplier|vendor)\b/;
const REFERENCE_HEADER = /\b(ref|reference|code|article|art|produit)\b/;
const isPersonal = (header: string) =>
  personalHeader(header) || (SUPPLIER_HEADER.test(header) && !REFERENCE_HEADER.test(header));

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Turns the model's answer into a layout the rest of the code can trust: a known kind, known fields
 * that kind has, real columns, one column per field, no SIREN without a SIREN header, confidence
 * below 0.8 flagged. Strong dictionary matches the model left out are kept when it agrees on the kind
 * and the header row.
 */
export function guardLayout(
  answer: LayoutAnswer,
  snapshot: SheetSnapshot,
  hint: LayoutMapping,
  p: Pseudonymizer,
): LayoutMapping {
  const notes: string[] = [];
  const known = (LAYOUT_KINDS as readonly string[]).includes(answer.kind);
  const kind = known ? (answer.kind as LayoutKind) : hint.kind;
  const kindConfidence = known ? clamp(answer.kindConfidence) : hint.kindConfidence;
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
  const fields = new Set<string>(LAYOUT_FIELDS);

  const proposals = answer.mapping
    .map((m) => ({
      field: m.field as LayoutField,
      column: m.column.trim().toUpperCase(),
      confidence: clamp(m.confidence),
    }))
    .filter((m) => fields.has(m.field) && ColumnLetters.safeParse(m.column).success)
    .filter((m) => columns.has(m.column) && fieldAllowed(kind, m.field))
    .filter((m) => {
      if (m.field !== 'partySiren') return true;
      const header = headerText(snapshot, headerRow, m.column);
      const ok =
        SIREN_HEADER.test(normalizeHeader(header)) ||
        layoutHeaderScore(header, 'partySiren', 'order') > 0;
      if (!ok) notes.push(t('mapping.warning.sirenDropped', { column: m.column }));
      return ok;
    })
    .sort((a, b) => b.confidence - a.confidence);

  const mapping: Partial<Record<LayoutField, FieldMapping>> = {};
  const used = new Set<string>();
  const take = (field: LayoutField, column: string, confidence: number) => {
    if (mapping[field] || used.has(column)) return;
    mapping[field] = { column, confidence, needsConfirmation: confidence < CONFIRM_BELOW };
    used.add(column);
  };
  for (const m of proposals) take(m.field, m.column, m.confidence);
  if (headerRow === hint.headerRow && kind === hint.kind) {
    for (const [field, m] of Object.entries(hint.mapping) as [LayoutField, FieldMapping][])
      if (m.confidence >= 0.85) take(field, m.column, m.confidence);
  }

  const own = answer.warnings
    .map((w) => p.unmask(w))
    .filter((w) => w.unknown.length === 0 && w.text.trim() !== '')
    .map((w) => w.text.trim().slice(0, 300))
    .slice(0, MAX_WARNINGS);

  return {
    sheet: snapshot.sheet,
    kind,
    kindConfidence,
    headerRow,
    mapping,
    warnings: [...new Set([...layoutWarnings(kind, mapping), ...notes, ...own])],
    source: 'agent',
  };
}

/** Proposes a layout for a sheet: the agent when AI is on and answers, the dictionary otherwise. */
export async function proposeLayout(
  snapshot: SheetSnapshot,
  ctx: MappingContext,
): Promise<LayoutResult> {
  const limited = { ...snapshot, rows: snapshot.rows.slice(0, MAX_ROWS) };
  const hint = detectLayout(limited);
  const fallback = (reason: Degraded): LayoutResult => ({
    layout: { ...hint, warnings: [degradedNote(reason), ...hint.warnings] },
    degraded: reason,
  });
  const { ai } = ctx;
  if (!ai) return fallback('ai_off');

  const p = new Pseudonymizer();
  const masked = maskSnapshot(p, limited, personalColumns(hint), isPersonal);
  const prompt = layoutPrompt(masked, hint, ctx.locale ?? 'fr-FR');
  const outcome = await ctx.orchestrator.run({
    tenantId: ctx.tenantId,
    phase: 'layout',
    provider: ai.provider,
    model: ai.modelId('classify'),
    promptHash: LAYOUT_PROMPT_HASH,
    estimatedTokens: estimateTokens(SYSTEM, prompt),
    ...(ctx.signal && { signal: ctx.signal }),
    call: (signal) =>
      callStructured({
        model: ai.model('classify'),
        system: SYSTEM,
        prompt,
        schema: LayoutAnswer,
        schemaName: 'sheet_layout',
        ...(ai.tools && { tools: { sampleColumn: sampleTool(masked) }, maxSteps: 4 }),
        maxOutputTokens: 2000,
        signal,
      }),
  });
  if (!outcome.ok) return fallback(outcome.reason);
  return { layout: guardLayout(outcome.output, limited, hint, p), degraded: null };
}
