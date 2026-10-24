// ReportAgent (plan §6 phase 9): the weekly summary, at most ten lines: four numbers (five when the
// checks found money not invoiced, R7), then up to three things to do, the most pressing first.
// Deterministic: the API counts, this file only words it. BTP stage 3C: the e-mail then lists the
// requests waiting in « À valider », each with its links (`approvalLines`).
import { type Cents, frDate, frMoney } from '@fi/core';
import type { ActionKind } from '@fi/domain';
import { type MessageKey, t } from '@fi/shared';

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
  /** R7: what the checks found billed short during the window, still open. */
  notInvoiced?: Tally;
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
  /** BTP stage 3C: requests waiting in « À valider » (Mode test apart). */
  approvals?: number;
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
    ...(f.approvals ? [t('report.action.approvals', { count: f.approvals })] : []),
    ...(f.drafts ? [t('report.action.drafts', { count: f.drafts })] : []),
    ...(f.toSend ? [t('report.action.toSend', { count: f.toSend })] : []),
  ].slice(0, MAX_ACTIONS);
}

/** `sender`: our name, or the accounting firm's under its full white label. */
export function weeklyReport(f: WeekFacts, sender = t('app.title')): WeeklyReport {
  const range = { from: frDate(f.from), to: frDate(f.to) };
  const tally = (key: 'sent' | 'paid' | 'overdue' | 'atRisk' | 'notInvoiced', v: Tally) =>
    t(`report.${key}`, { count: v.count, amount: frMoney(v.amount, f.currency) });
  const title = t('report.title', range);
  const numbers = [
    tally('sent', f.sent),
    tally('paid', f.paid),
    tally('overdue', f.overdue),
    tally('atRisk', f.atRisk),
    ...(f.notInvoiced?.count ? [tally('notInvoiced', f.notInvoiced)] : []),
  ];
  const actions = actionsFor(f);
  const tail = actions.length
    ? [t('report.todo'), ...actions.map((a) => `• ${a}`)]
    : [t('report.nothing')];
  return {
    subject: t('report.subject', { ...range, sender }),
    title,
    numbers,
    actions,
    text: [title, ...numbers, ...tail].join('\n'),
  };
}

/** A request the weekly e-mail lists with its links (BTP stage 3C); the API makes the links. */
export interface ApprovalItem {
  kind: ActionKind;
  /** The company asked; null for `confirmer_tiers`, which names the SIREN. */
  company: string | null;
  siren: string | null;
  /** The deadline's day, when the request serves one. */
  dueOn: string | null;
  to: string | null;
  /** « Envoyer » (« Ajouter comme fournisseur »); null while the address is missing. */
  approveUrl: string | null;
  rejectUrl: string;
}

/** The e-mail's « À valider » part: each request and its links, then how many more wait in the pane. */
export function approvalLines(items: readonly ApprovalItem[], more = 0): string[] {
  if (items.length === 0) return [];
  const lines = ['', t('report.approvals.title', { count: items.length + more })];
  for (const a of items) {
    const kind = t(`action.kind.${a.kind}` as MessageKey);
    lines.push('');
    if (a.kind === 'confirmer_tiers') {
      lines.push(`• ${t('report.approvals.unknown', { siren: a.siren ?? '' })}`);
    } else {
      const company = a.company ?? '';
      lines.push(
        `• ${
          a.dueOn
            ? t('report.approvals.item', { kind, company, due: frDate(a.dueOn) })
            : t('report.approvals.itemNoDue', { kind, company })
        }`,
        `  ${a.to ? t('report.approvals.to', { to: a.to }) : t('report.approvals.noRecipient')}`,
      );
    }
    if (a.approveUrl) {
      const key = a.kind === 'confirmer_tiers' ? 'report.approvals.add' : 'report.approvals.send';
      lines.push(`  ${t(key, { url: a.approveUrl })}`);
    }
    lines.push(`  ${t('report.approvals.reject', { url: a.rejectUrl })}`);
  }
  if (more > 0) lines.push('', t('report.approvals.more', { count: more }));
  lines.push('', t('report.approvals.howTo'));
  return lines;
}
