// ReportAgent (plan §6 phase 9): the weekly summary, at most ten lines: four numbers (five when the
// checks found money not invoiced, R7), then up to three things to do, the most pressing first.
// Deterministic: the API counts, this file only words it. BTP stage 3C: the e-mail then lists the
// requests waiting in « À valider », each with its links (`approvalLines`). Memory M5: what the rules
// raised during the week (three at most), and the completeness block: what was received and filed,
// which rules ran, what the memory asks and what it waits to have mended.
import { type Cents, frDate, frMoney } from '@fi/core';
import type { ActionKind } from '@fi/domain';
import { type MessageKey, t } from '@fi/shared';
import type { Found } from './rules/context';
import { noticeOf } from './rules/notice';

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
  /** The money received during the window (a part payment included), and on how many invoices. */
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
  /** Memory M5: what the rules raised during the window, the latest first. */
  spotted?: { rule: string; facts: Found['facts'] }[];
  /** Memory M5: shown once the company receives documents or keeps a memory. */
  completeness?: Completeness;
}

export interface Completeness {
  /** Documents received during the window, and how many of them reached their last stage. */
  received: number;
  filed: number;
  /** The catalogue's rules that ran during the window, of those that should have. */
  rulesRun: number;
  rulesDue: number;
  /** The memory's open questions and the blocking ones; null where no memory is open. */
  questions: { open: number; blocking: number } | null;
  /** Lint findings waiting for a person's approval. */
  fixes: number;
}

export interface WeeklyReport {
  subject: string;
  title: string;
  numbers: string[];
  actions: string[];
  /** Memory M5: what the rules raised, then the completeness block; empty without them. */
  spotted: string[];
  completeness: string[];
  /**
   * The plain-text e-mail and card: title, numbers, the actions or « nothing to do », then what the
   * rules raised and the completeness block.
   */
  text: string;
}

function spottedLines(f: WeekFacts): string[] {
  const all = f.spotted ?? [];
  if (all.length === 0) return [];
  const lines = all.slice(0, MAX_SPOTTED).map((s) => {
    const { title, text } = noticeOf(s.rule, s.facts);
    return `${title} : ${text}`;
  });
  const more = all.length - lines.length;
  return more > 0 ? [...lines, t('report.spotted.more', { count: more })] : lines;
}

function completenessLines(c: Completeness | undefined): string[] {
  if (!c) return [];
  return [
    t('report.completeness.documents', { received: c.received, filed: c.filed }),
    t('report.completeness.rules', { run: c.rulesRun, due: c.rulesDue }),
    ...(c.questions ? [t('report.completeness.questions', { ...c.questions })] : []),
    ...(c.fixes ? [t('report.completeness.fixes', { count: c.fixes })] : []),
  ];
}

export const MAX_ACTIONS = 3;
export const MAX_SPOTTED = 3;

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
    ...(f.completeness?.questions?.blocking
      ? [t('report.action.questions', { count: f.completeness.questions.blocking })]
      : []),
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
  const spotted = spottedLines(f);
  const completeness = completenessLines(f.completeness);
  return {
    subject: t('report.subject', { ...range, sender }),
    title,
    numbers,
    actions,
    spotted,
    completeness,
    text: [
      title,
      ...numbers,
      ...tail,
      ...(spotted.length ? ['', t('report.spotted.title'), ...spotted.map((s) => `• ${s}`)] : []),
      ...(completeness.length
        ? ['', t('report.completeness.title'), ...completeness.map((c) => `• ${c}`)]
        : []),
    ].join('\n'),
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

/**
 * What one request is, in the e-mail and in Telegram (memory M4): what, to whom, by when; then where
 * it goes, or that its address is missing. One line for an unknown company.
 */
export function approvalSummary(
  a: Pick<ApprovalItem, 'kind' | 'company' | 'siren' | 'dueOn' | 'to'>,
): string[] {
  if (a.kind === 'confirmer_tiers')
    return [t('report.approvals.unknown', { siren: a.siren ?? '' })];
  const kind = t(`action.kind.${a.kind}` as MessageKey);
  const company = a.company ?? '';
  return [
    a.dueOn
      ? t('report.approvals.item', { kind, company, due: frDate(a.dueOn) })
      : t('report.approvals.itemNoDue', { kind, company }),
    a.to ? t('report.approvals.to', { to: a.to }) : t('report.approvals.noRecipient'),
  ];
}

/** The e-mail's « À valider » part: each request and its links, then how many more wait in the pane. */
export function approvalLines(items: readonly ApprovalItem[], more = 0): string[] {
  if (items.length === 0) return [];
  const lines = ['', t('report.approvals.title', { count: items.length + more })];
  for (const a of items) {
    const [what, where] = approvalSummary(a);
    lines.push('', `• ${what}`);
    if (where) lines.push(`  ${where}`);
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
