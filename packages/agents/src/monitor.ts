// MonitorAgent (plan §6 phase 7): after a platform rejection or a customer refusal, says what to do
// next. A rejection is read by code: the rule ids found in the platform's answer, and « fix and
// resend ». A refusal goes to a model, after pseudonymization, which picks one of three proposals and
// drafts a reply; its answer is checked (known proposal, no invented token, no amount but the
// invoice's own) and anything doubtful falls back to the three options, with a template draft. The
// agent never resends and never changes a status: it writes advice.
import { type Cents, type ChaseDraft, frDate, frMoney, RULES } from '@fi/core';
import { t } from '@fi/shared';
import { z } from 'zod';
import type { AiHandle } from './ai';
import { callStructured, estimateTokens, promptHash, readPrompt } from './llm';
import type { Degraded } from './mapping';
import type { Orchestrator } from './orchestrator';
import { Pseudonymizer } from './pseudonymize';

export const MONITOR_PROPOSALS = ['fix_and_resend', 'credit_note', 'contact_customer'] as const;
export type MonitorProposal = (typeof MONITOR_PROPOSALS)[number];

export const MonitorAnswer = z.object({
  proposal: z.enum(MONITOR_PROPOSALS),
  why: z.string(),
  draft_body: z.string(),
});
export type MonitorAnswer = z.infer<typeof MonitorAnswer>;

const SYSTEM = readPrompt('monitor.md');
export const MONITOR_PROMPT_HASH = promptHash(SYSTEM, MonitorAnswer);

export interface MonitorInvoice {
  number: string;
  issueDate: string;
  dueDate: string | null;
  payable: Cents;
  currency: string;
  seller: string;
  customer: string;
  /** The customer's e-mail address on the invoice (BT-58), if any. */
  to: string | null;
}

/** What the platform said: its rejection messages, or the customer's refusal reason. */
export type MonitorEvent =
  | { kind: 'rejection'; errors: { rule: string; message: string }[] }
  | { kind: 'refusal'; reason: { code?: string; text?: string } | null };

export interface MonitorAdvice {
  kind: MonitorEvent['kind'];
  /** Null when the agent could not choose: the user sees the three options. */
  proposal: MonitorProposal | null;
  why: string;
  /** Rejections: the rule ids of our catalogue found in the platform's answer. */
  rules: string[];
  /** Refusals: a reply to the customer, for the user to review and send. */
  draft: ChaseDraft | null;
  source: 'agent' | 'rules';
  degraded: Degraded | null;
}

export interface MonitorResult {
  advice: MonitorAdvice;
  /** Answers the guardrails threw away, counted for the evals and the server log. */
  rejected: { unknownTokens: number; wrongAmount: number; tooLong: number };
}

export interface MonitorContext {
  tenantId: string;
  invoiceId?: string;
  ai: AiHandle | null;
  orchestrator: Orchestrator;
  signal?: AbortSignal;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULE_ID = new RegExp(
  `(?<![\\w-])(${RULES.map((r) => r.id)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})(?![\\w-])`,
  'g',
);

/** The rule ids of our catalogue named in the platform's answer, in order, once each. */
export function rulesIn(errors: readonly { rule: string; message: string }[]): string[] {
  const found = errors.flatMap((e) =>
    [...`${e.rule} ${e.message}`.matchAll(RULE_ID)].map((m) => m[1]),
  );
  return [...new Set(found.filter((id): id is string => id !== undefined))];
}

function rejectionAdvice(errors: readonly { rule: string; message: string }[]): MonitorAdvice {
  const rules = rulesIn(errors);
  return {
    kind: 'rejection',
    proposal: 'fix_and_resend',
    why: [
      t('monitor.rejection.why'),
      ...(rules.length ? [t('monitor.rejection.rules', { rules: rules.join(', ') })] : []),
    ].join(' '),
    rules,
    draft: null,
    source: 'rules',
    degraded: null,
  };
}

const reasonOf = (r: { code?: string; text?: string } | null) => r?.text?.trim() || r?.code || '';

function templateDraft(invoice: MonitorInvoice, reason: string): ChaseDraft {
  const amount = frMoney(invoice.payable, invoice.currency);
  return {
    to: invoice.to,
    subject: t('monitor.draft.subject', { number: invoice.number }),
    body: t('monitor.draft.body', {
      number: invoice.number,
      amount,
      reason: reason ? t('monitor.draft.reason', { reason }) : '',
      seller: invoice.seller,
    }),
  };
}

/** Every amount written in the draft, in cents: "1 234,56 €", "1234.56 EUR", "80 euros". */
export function amountsIn(text: string): number[] {
  const re = /(\d[\d   .]*(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(?:€|EUR\b|euros?\b)/giu;
  return [...text.matchAll(re)].map((m) => {
    const raw = (m[1] ?? '').replace(/[   ]/g, '');
    const decimal = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    return Math.round(Number(decimal) * 100);
  });
}

export function monitorPrompt(
  invoice: MonitorInvoice,
  event: MonitorEvent & { kind: 'refusal' },
  p: Pseudonymizer,
) {
  p.protect('PARTY', invoice.seller).protect('PARTY', invoice.customer);
  if (invoice.to) p.protect('EMAIL', invoice.to);
  return JSON.stringify({
    invoice: {
      number: invoice.number,
      amount: frMoney(invoice.payable, invoice.currency),
      issueDate: frDate(invoice.issueDate),
      dueDate: invoice.dueDate ? frDate(invoice.dueDate) : null,
      seller: p.token('PARTY', invoice.seller),
      customer: p.token('PARTY', invoice.customer),
    },
    refusal: {
      code: event.reason?.code ?? null,
      text: event.reason?.text ? p.mask(event.reason.text) : null,
    },
  });
}

const fits = (s: string, max: number) => s.trim() !== '' && s.length <= max;

/** What the user does next after a rejection or a refusal. Never changes the invoice. */
export async function adviseNext(
  invoice: MonitorInvoice,
  event: MonitorEvent,
  ctx: MonitorContext,
): Promise<MonitorResult> {
  const rejected = { unknownTokens: 0, wrongAmount: 0, tooLong: 0 };
  if (event.kind === 'rejection') return { advice: rejectionAdvice(event.errors), rejected };

  const reason = reasonOf(event.reason);
  const fallback = (degraded: Degraded | null): MonitorResult => ({
    advice: {
      kind: 'refusal',
      proposal: null,
      why: t('monitor.refusal.open'),
      rules: [],
      draft: templateDraft(invoice, reason),
      source: 'rules',
      degraded,
    },
    rejected,
  });
  const { ai } = ctx;
  if (!ai) return fallback('ai_off');

  const p = new Pseudonymizer();
  const prompt = monitorPrompt(invoice, event, p);
  const outcome = await ctx.orchestrator.run({
    tenantId: ctx.tenantId,
    ...(ctx.invoiceId && { invoiceId: ctx.invoiceId }),
    phase: 'monitor',
    provider: ai.provider,
    model: ai.modelId('agent'),
    promptHash: MONITOR_PROMPT_HASH,
    estimatedTokens: estimateTokens(SYSTEM, prompt),
    ...(ctx.signal && { signal: ctx.signal }),
    call: (signal) =>
      callStructured({
        model: ai.model('agent'),
        system: SYSTEM,
        prompt,
        schema: MonitorAnswer,
        schemaName: 'next_step',
        maxOutputTokens: 1200,
        signal,
      }),
  });
  if (!outcome.ok) return fallback(outcome.reason);

  const texts = p.unmaskDeep({ why: outcome.output.why, body: outcome.output.draft_body });
  if (texts.unknown.length > 0) {
    rejected.unknownTokens++;
    return fallback(null);
  }
  const { why, body } = texts.value;
  if (!fits(why, 400) || !fits(body, 1500)) {
    rejected.tooLong++;
    return fallback(null);
  }
  if (amountsIn(body).some((cents) => cents !== invoice.payable)) {
    rejected.wrongAmount++;
    return fallback(null);
  }
  return {
    advice: {
      kind: 'refusal',
      proposal: outcome.output.proposal,
      why: why.trim(),
      rules: [],
      draft: {
        to: invoice.to,
        subject: t('monitor.draft.subject', { number: invoice.number }),
        body: body.trim(),
      },
      source: 'agent',
      degraded: null,
    },
    rejected,
  };
}
