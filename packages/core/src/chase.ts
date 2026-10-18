// Chasing plans (plan §4 `chase_plans`, §6 CollectAgent): which reminder is due on which day. Pure:
// the API stores the plan and acts on it, the CollectAgent writes the e-mails and decides who sends.
import { z } from 'zod';
import { addDays, parisHour, parisToday } from './dates';
import type { InvoiceState } from './state';

export const CHASE_KINDS = ['courtesy', 'reminder', 'firm', 'formal_notice'] as const;
export type ChaseKind = (typeof CHASE_KINDS)[number];

/**
 * pending: its day has not come · drafted: due, the draft waits for the user · sending: the autopilot
 * is sending it · sent: by the autopilot or, as the user says, by the user · skipped: a later step was
 * due too · cancelled: the plan ended before it.
 */
export const STEP_STATUSES = [
  'pending',
  'drafted',
  'sending',
  'sent',
  'skipped',
  'cancelled',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * Why a step is a draft rather than sent, or why it was skipped or cancelled. A draft always says
 * why the autopilot left it to the user.
 */
export const STEP_REASONS = [
  'review',
  'formal_notice',
  'test',
  'ceiling',
  'no_recipient',
  'no_mailer',
  'send_failed',
  'send_unknown',
  'manual',
  'superseded',
  'ended',
] as const;
export type StepReason = (typeof STEP_REASONS)[number];

export const ChaseDraft = z.object({
  /** The customer's e-mail address from the invoice (BT-58), when it has one. */
  to: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
});
export type ChaseDraft = z.infer<typeof ChaseDraft>;

export const ChaseStep = z.object({
  /** Days from the due date: -3 is three days before it. */
  offset: z.number().int(),
  kind: z.enum(CHASE_KINDS),
  /** Due date + offset. */
  date: z.string(),
  status: z.enum(STEP_STATUSES),
  /** When the step was acted on (ISO instant, business time). */
  at: z.string().nullable(),
  /** Who sent it: the autopilot, or the user who says so. */
  by: z.enum(['agent', 'user']).nullable(),
  reason: z.enum(STEP_REASONS).nullable(),
  draft: ChaseDraft.nullable(),
});
export type ChaseStep = z.infer<typeof ChaseStep>;

/** Statuses in which a plan runs: the customer has the invoice and has not paid it. */
export const CHASED_STATES: readonly InvoiceState[] = [
  'delivered',
  'accepted',
  'overdue',
  'chasing',
];
/** A refusal or a dispute pauses the plan (plan §6 CollectAgent guardrail). */
export const PAUSED_STATES: readonly InvoiceState[] = ['refused_by_customer', 'disputed'];
/** Paid, given up or cancelled by a credit note: the plan ends. */
export const ENDED_STATES: readonly InvoiceState[] = [
  'paid',
  'written_off',
  'credited',
  'cancelled',
];

/** From this hour (Europe/Paris) the step of the day is acted on: nobody gets a reminder at midnight. */
export const CHASE_HOUR = 9;

/**
 * The tone of a step from its offset (plan §6 default cadence: J-3 courtesy, J+1 and J+8 reminders,
 * J+15 firm, J+30 formal notice draft). A company's own cadence gets the same tone for the same delay.
 */
export function chaseKind(offset: number): ChaseKind {
  if (offset <= 0) return 'courtesy';
  if (offset < 15) return 'reminder';
  if (offset < 30) return 'firm';
  return 'formal_notice';
}

const pendingStep = (offset: number, dueDate: string): ChaseStep => ({
  offset,
  kind: chaseKind(offset),
  date: addDays(dueDate, offset),
  status: 'pending',
  at: null,
  by: null,
  reason: null,
  draft: null,
});

export function planSteps(cadence: readonly number[], dueDate: string): ChaseStep[] {
  return [...new Set(cadence)].sort((a, b) => a - b).map((offset) => pendingStep(offset, dueDate));
}

/**
 * A new cadence or due date: the steps already acted on stay as they are, the pending ones are
 * replaced by the cadence's steps that come after them.
 */
export function reschedule(
  steps: readonly ChaseStep[],
  cadence: readonly number[],
  dueDate: string,
): ChaseStep[] {
  const done = steps.filter((s) => s.status !== 'pending');
  const after = Math.max(Number.NEGATIVE_INFINITY, ...done.map((s) => s.offset));
  return [...done, ...planSteps(cadence, dueDate).filter((s) => s.offset > after)];
}

export interface Advance {
  steps: ChaseStep[];
  /** Index in `steps` of the step to act on now; the caller drafts or sends it. */
  act: number | null;
}

/**
 * What is due now: the latest pending step whose day has come (from CHASE_HOUR on that day). The
 * earlier ones, and a draft the user has not sent yet, are skipped rather than sent in a burst. A
 * payment promise holds every step until the day after it.
 */
export function advance(
  steps: readonly ChaseStep[],
  now: Date,
  promisedUntil: string | null = null,
): Advance {
  const today = parisToday(now);
  const unchanged = { steps: [...steps], act: null };
  if (promisedUntil && today <= promisedUntil) return unchanged;
  const ready = (s: ChaseStep) =>
    s.status === 'pending' &&
    (s.date < today || (s.date === today && parisHour(now) >= CHASE_HOUR));
  const act = steps.findLastIndex(ready);
  if (act < 0) return unchanged;
  const at = now.toISOString();
  return {
    act,
    steps: steps.map((s, i) =>
      i < act && (s.status === 'pending' || s.status === 'drafted')
        ? { ...s, status: 'skipped', at, reason: 'superseded' }
        : s,
    ),
  };
}

/** The invoice was paid, written off or credited: what was still to come will not happen. */
export function endSteps(steps: readonly ChaseStep[], now: Date): ChaseStep[] {
  const at = now.toISOString();
  return steps.map((s) =>
    s.status === 'pending' || s.status === 'drafted'
      ? { ...s, status: 'cancelled', at, reason: 'ended' }
      : s,
  );
}

/** The day of the next pending step, or null when nothing is left to do. */
export const nextStepOn = (steps: readonly ChaseStep[]): string | null =>
  steps.find((s) => s.status === 'pending')?.date ?? null;
