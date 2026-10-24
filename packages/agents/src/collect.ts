// CollectAgent (plan §6 phase 8): writes the e-mail of a chasing step and decides whether the autopilot
// may send it. Deterministic on purpose: the number, the amount, the dates and the legal wording come
// from the invoice and from fr.json, never from a model. The first line of `autopilotDecision` is the
// guardrail the plan insists on: a formal notice (mise en demeure) is never sent automatically.
import {
  type Cents,
  type ChaseDraft,
  type ChaseKind,
  daysBetween,
  frDate,
  frMoney,
  type StepReason,
} from '@fi/core';
import { type MessageKey, t } from '@fi/shared';

export interface ChaseFacts {
  kind: ChaseKind;
  number: string;
  issueDate: string;
  dueDate: string;
  /** Europe/Paris, the day the step is acted on. */
  today: string;
  /** The invoice's amount payable (BT-115). */
  payable: Cents;
  /** What the customer paid so far (instalments); the letter asks for the rest. */
  paid?: Cents;
  currency: string;
  /** The company that chases (the tenant's name). */
  seller: string;
  /** The customer's e-mail address on the invoice (BT-58), if any. */
  to: string | null;
  isTest: boolean;
}

export function draftChase(f: ChaseFacts): ChaseDraft {
  const paid = f.paid ?? 0;
  const owed = frMoney(Math.max(0, f.payable - paid), f.currency);
  const params = {
    number: f.number,
    amount: frMoney(f.payable, f.currency),
    owed,
    paidLine: paid > 0 ? t('chase.paidLine', { paid: frMoney(paid, f.currency), owed }) : '',
    issue: frDate(f.issueDate),
    due: frDate(f.dueDate),
    days: Math.max(0, daysBetween(f.dueDate, f.today)),
    seller: f.seller,
  };
  const subject = t(`chase.subject.${f.kind}` as MessageKey, params);
  return {
    to: f.to,
    // A test invoice's draft says so, in case someone pastes it into a real e-mail.
    subject: f.isTest ? `${t('chase.testPrefix')}${subject}` : subject,
    body: t(`chase.body.${f.kind}` as MessageKey, params),
  };
}

export interface AutopilotPolicy {
  mode: 'review' | 'autopilot';
  /** The highest amount, in cents, the autopilot chases by itself; null means none. */
  maxAmount: Cents | null;
  /** Whether this deployment can send e-mail at all. */
  mailer: boolean;
}

export type SendDecision = { send: true } | { send: false; reason: StepReason };

/** Whether the autopilot sends this step itself (plan §6: only steps up to « firm »), and if not, why. */
export function autopilotDecision(
  kind: ChaseKind,
  policy: AutopilotPolicy,
  invoice: { payable: Cents; isTest: boolean; to: string | null },
): SendDecision {
  if (kind === 'formal_notice') return { send: false, reason: 'formal_notice' };
  if (policy.mode !== 'autopilot') return { send: false, reason: 'review' };
  if (invoice.isTest) return { send: false, reason: 'test' };
  if (!policy.mailer) return { send: false, reason: 'no_mailer' };
  if (policy.maxAmount === null || invoice.payable > policy.maxAmount) {
    return { send: false, reason: 'ceiling' };
  }
  if (!invoice.to) return { send: false, reason: 'no_recipient' };
  return { send: true };
}
