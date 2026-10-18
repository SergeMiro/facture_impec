// ExplainAgent (plan §6): turns rule issues into plain-French explanations with steps to fix them in
// the sheet. Rules decide, the model only words it. The cell comes from the sheet reading, never from
// the model, and an automatic fix exists only for formatting rules and is computed here: a value the
// model proposes is accepted only when it equals ours.
import { dateFromText, type Invoice, type Issue, type Scope } from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import { z } from 'zod';
import type { AiHandle } from './ai';
import { callStructured, estimateTokens, promptHash, readPrompt } from './llm';
import type { Degraded } from './mapping';
import { maskInvoice } from './masking';
import type { Orchestrator } from './orchestrator';
import { Pseudonymizer } from './pseudonymize';

export const ExplainAnswer = z.object({
  explanations: z.array(
    z.object({
      index: z.number(),
      message_fr: z.string(),
      why_it_matters: z.string(),
      fix_steps: z.array(z.string()),
      auto_fix_value: z.string().nullable(),
    }),
  ),
});
export type ExplainAnswer = z.infer<typeof ExplainAnswer>;

const SYSTEM = readPrompt('explain.md');
export const EXPLAIN_PROMPT_HASH = promptHash(SYSTEM, ExplainAnswer);

/** Issues sent in one call; the rest get the standard explanation. */
const MAX_ISSUES = 20;

export interface Explanation {
  ruleId: string;
  path: string;
  severity: Issue['severity'];
  message_fr: string;
  why_it_matters: string;
  fix_steps: string[];
  /** A1-style address of the cell to fix, when the invoice comes from a sheet. */
  cell: string | null;
  auto_fix: { value: string } | null;
  source: 'agent' | 'rules';
}

export interface ExplainResult {
  explanations: Explanation[];
  degraded: Degraded | null;
  /** Answers the guardrails threw away, counted for the evals and the server log. */
  rejected: {
    forbiddenAutoFix: number;
    wrongAutoFix: number;
    unknownTokens: number;
    missing: number;
  };
}

export interface ExplainContext {
  tenantId: string;
  invoiceId?: string;
  ai: AiHandle | null;
  orchestrator: Orchestrator;
  /** Invoice path → cell address (`cellForPath` over the sheet reading). */
  cellFor?: (path: string) => string | null;
  signal?: AbortSignal;
}

/** `lines[2].vat.rate` → the value at that path, if it is a string. */
export function valueAt(value: unknown, path: string): string | undefined {
  let at: unknown = value;
  for (const part of path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== '')) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return typeof at === 'string' ? at : undefined;
}

/** Amounts are never fixed automatically, whatever a rule says (plan §6). */
const AMOUNT_PATH = /(amount|Amount|total|Total|prepaid|payable|rounding|price|quantity)/;

/** The formatting fix of an auto-fixable rule, or null when there is nothing safe to propose. */
export function autoFixFor(issue: Issue, invoice: Invoice): string | null {
  if (!issue.autoFixable || AMOUNT_PATH.test(issue.path)) return null;
  const current = valueAt(invoice, issue.path);
  if (current === undefined) return null;
  let fixed: string | undefined;
  switch (issue.ruleId) {
    case 'FF-FMT-01':
      fixed = current.trim();
      break;
    case 'FF-FMT-02':
      fixed = current.replace(/[\s.]/g, '').toUpperCase();
      break;
    case 'FF-FMT-03':
      fixed = dateFromText(current);
      break;
    case 'FF-RATE-01':
      fixed = current.trim().replace(',', '.');
      break;
  }
  return fixed !== undefined && fixed !== '' && fixed !== current ? fixed : null;
}

const why = (scope: Scope) => t(`explain.why.${scope}` as MessageKey);

function standard(issue: Issue, invoice: Invoice, ctx: ExplainContext): Explanation {
  const value = autoFixFor(issue, invoice);
  return {
    ruleId: issue.ruleId,
    path: issue.path,
    severity: issue.severity,
    message_fr: issue.messageFr,
    why_it_matters: why(issue.scope),
    fix_steps: [issue.fixHintFr],
    cell: ctx.cellFor?.(issue.path) ?? null,
    auto_fix: value === null ? null : { value },
    source: 'rules',
  };
}

const fits = (s: string, max: number) => s.trim() !== '' && s.length <= max;

export function explainPrompt(
  masked: Invoice,
  issues: readonly Issue[],
  p: Pseudonymizer,
  invoice: Invoice,
) {
  return JSON.stringify({
    invoice: masked,
    issues: issues.map((issue, index) => {
      const current = valueAt(invoice, issue.path);
      return {
        index,
        ruleId: issue.ruleId,
        severity: issue.severity,
        field: issue.path,
        currentValue: current === undefined ? null : p.mask(current),
        message: p.mask(issue.messageFr),
        fixHint: p.mask(issue.fixHintFr),
        autoFixable: issue.autoFixable,
      };
    }),
  });
}

/** Checks the model's answer issue by issue; anything doubtful falls back to the rule's own text. */
export function guardExplanations(
  answer: ExplainAnswer,
  issues: readonly Issue[],
  invoice: Invoice,
  p: Pseudonymizer,
  ctx: ExplainContext,
): Pick<ExplainResult, 'explanations' | 'rejected'> {
  const rejected = { forbiddenAutoFix: 0, wrongAutoFix: 0, unknownTokens: 0, missing: 0 };
  const byIndex = new Map(answer.explanations.map((e) => [e.index, e]));
  const explanations = issues.map((issue, index) => {
    const base = standard(issue, invoice, ctx);
    const e = byIndex.get(index);
    if (!e) {
      rejected.missing++;
      return base;
    }
    if (e.auto_fix_value !== null) {
      if (base.auto_fix === null) rejected.forbiddenAutoFix++;
      else if (p.unmask(e.auto_fix_value).text !== base.auto_fix.value) rejected.wrongAutoFix++;
    }
    const texts = p.unmaskDeep({
      message: e.message_fr,
      why: e.why_it_matters,
      steps: e.fix_steps.slice(0, 3),
    });
    if (texts.unknown.length > 0) {
      rejected.unknownTokens++;
      return base;
    }
    const { message, why: reason, steps } = texts.value;
    if (
      !fits(message, 400) ||
      !fits(reason, 300) ||
      steps.length === 0 ||
      !steps.every((s) => fits(s, 200))
    )
      return base;
    return {
      ...base,
      message_fr: message.trim(),
      why_it_matters: reason.trim(),
      fix_steps: steps.map((s) => s.trim()),
      source: 'agent' as const,
    };
  });
  return { explanations, rejected };
}

/** Explains the issues of one invoice. Never changes the invoice. */
export async function explainIssues(
  invoice: Invoice,
  issues: readonly Issue[],
  ctx: ExplainContext,
): Promise<ExplainResult> {
  const none = { forbiddenAutoFix: 0, wrongAutoFix: 0, unknownTokens: 0, missing: 0 };
  const fallback = (degraded: Degraded | null): ExplainResult => ({
    explanations: issues.map((i) => standard(i, invoice, ctx)),
    degraded,
    rejected: none,
  });
  if (issues.length === 0) return fallback(null);
  const { ai } = ctx;
  if (!ai) return fallback('ai_off');

  const sent = issues.slice(0, MAX_ISSUES);
  const p = new Pseudonymizer();
  const masked = maskInvoice(p, invoice);
  const prompt = explainPrompt(masked, sent, p, invoice);
  const outcome = await ctx.orchestrator.run({
    tenantId: ctx.tenantId,
    ...(ctx.invoiceId && { invoiceId: ctx.invoiceId }),
    phase: 'explain',
    provider: ai.provider,
    model: ai.modelId('agent'),
    promptHash: EXPLAIN_PROMPT_HASH,
    estimatedTokens: estimateTokens(SYSTEM, prompt),
    ...(ctx.signal && { signal: ctx.signal }),
    call: (signal) =>
      callStructured({
        model: ai.model('agent'),
        system: SYSTEM,
        prompt,
        schema: ExplainAnswer,
        schemaName: 'explanations',
        maxOutputTokens: Math.min(6000, 600 + 300 * sent.length),
        signal,
      }),
  });
  if (!outcome.ok) return fallback(outcome.reason);
  const guarded = guardExplanations(outcome.output, sent, invoice, p, ctx);
  return {
    explanations: [
      ...guarded.explanations,
      ...issues.slice(MAX_ISSUES).map((i) => standard(i, invoice, ctx)),
    ],
    degraded: null,
    rejected: guarded.rejected,
  };
}

export const explainDegradedNote = (reason: Degraded) =>
  t(`explain.degraded.${reason}` as MessageKey);
