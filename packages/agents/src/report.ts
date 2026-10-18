// ReportAgent (plan §6 phase 9): the weekly summary, at most ten lines: four numbers, then up to three
// things to do, the most pressing first. Deterministic: the API counts, this file only words it.
import { type Cents, frDate, frMoney } from '@fi/core';
import { t } from '@fi/shared';

export interface Tally {
  count: number;
  amount: Cents;
}

export interface WeekFacts {
  /** The 7-day window, Europe/Paris dates, both included. */
  from: string;
  to: string;
  currency: string;
  /** Reached the platform during the window. */
  sent: Tally;
  /** Recorded as paid during the window. */
  paid: Tally;
  /** Unpaid past their due date, today. */
  overdue: Tally;
  /** Delivered or accepted, due within the next 7 days. */
  atRisk: Tally;
  /** Formal notices drafted and waiting for the user. */
  formalNotices: { number: string; payable: Cents }[];
  /** Invoices the customer refused, not yet handled. */
  refusals: string[];
  /** Rejected by the platform or to correct. */
  toFix: number;
  /** Chasing e-mails drafted and waiting for the user (formal notices apart). */
  drafts: number;
  /** Validated, waiting for « Envoyer ». */
  toSend: number;
}

export interface WeeklyReport {
  subject: string;
  title: string;
  numbers: string[];
  actions: string[];
  /** The plain-text e-mail and card: title, numbers, then the actions or « nothing to do ». */
  text: string;
}

export const MAX_ACTIONS = 3;

function actionsFor(f: WeekFacts): string[] {
  const money = (cents: Cents) => frMoney(cents, f.currency);
  const notices = [...f.formalNotices]
    .sort((a, b) => b.payable - a.payable)
    .map((n) => t('report.action.formalNotice', { number: n.number, amount: money(n.payable) }));
  const [refused] = f.refusals;
  const refusals =
    f.refusals.length > 1
      ? [t('report.action.refusals', { count: f.refusals.length })]
      : refused
        ? [t('report.action.refusal', { number: refused })]
        : [];
  return [
    ...notices,
    ...refusals,
    ...(f.toFix ? [t('report.action.fix', { count: f.toFix })] : []),
    ...(f.drafts ? [t('report.action.drafts', { count: f.drafts })] : []),
    ...(f.toSend ? [t('report.action.toSend', { count: f.toSend })] : []),
  ].slice(0, MAX_ACTIONS);
}

export function weeklyReport(f: WeekFacts): WeeklyReport {
  const range = { from: frDate(f.from), to: frDate(f.to) };
  const tally = (key: 'sent' | 'paid' | 'overdue' | 'atRisk', v: Tally) =>
    t(`report.${key}`, { count: v.count, amount: frMoney(v.amount, f.currency) });
  const title = t('report.title', range);
  const numbers = [
    tally('sent', f.sent),
    tally('paid', f.paid),
    tally('overdue', f.overdue),
    tally('atRisk', f.atRisk),
  ];
  const actions = actionsFor(f);
  const tail = actions.length
    ? [t('report.todo'), ...actions.map((a) => `• ${a}`)]
    : [t('report.nothing')];
  return {
    subject: t('report.subject', range),
    title,
    numbers,
    actions,
    text: [title, ...numbers, ...tail].join('\n'),
  };
}
