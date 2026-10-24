// The requests the deadline watchers draft (BTP plan §7 `composeDraft`, docs/DECISIONS.md D8): a new
// attestation, Kbis or insurance certificate asked of a supplier, the retenue de garantie asked of a
// customer, an unpaid invoice that came as a document. Deterministic, as CollectAgent's letters: the
// dates, the amount and the legal wording come from the deadline and from fr.json, never from a
// model, and nothing about the companies leaves for one. A person reads every draft before it goes.
import { type Cents, frDate, frMoney } from '@fi/core';
import type { ActionKind } from '@fi/domain';
import { type MessageKey, t } from '@fi/shared';

/** What a request asks; `confirmer_tiers` asks the company itself and has no letter. */
export type RequestKind = Exclude<ActionKind, 'confirmer_tiers'>;

export interface RequestFacts {
  kind: RequestKind;
  /** The company that asks (the tenant's name), as it signs. */
  company: string;
  /** The recipient's address, when the company knows it. */
  to: string | null;
  /** The deadline's day: the end of the six months, of the cover, of the year after the réception. */
  dueOn: string;
  /** Europe/Paris, the day it is drafted: before the deadline the letter says « arrive », after « est arrivée ». */
  today: string;
  /** The invoice reminded (its number), for `relance_facture`. */
  reference?: string | null;
  /** What is left to pay, or the retenue, when it is known. */
  amount?: Cents | null;
  currency?: string;
  /** Which insurance, for `demande_attestation_assurance`. */
  insurance?: 'decennale' | 'rc' | null;
  isTest: boolean;
}

export interface RequestDraft {
  to: string | null;
  subject: string;
  body: string;
}

export function draftRequest(f: RequestFacts): RequestDraft {
  const due = frDate(f.dueOn);
  const late = f.dueOn < f.today;
  const amount =
    f.amount !== null && f.amount !== undefined && f.amount > 0
      ? frMoney(f.amount, f.currency ?? 'EUR')
      : null;
  const params = {
    company: f.company,
    due,
    when: t(late ? 'request.when.late' : 'request.when.soon', { due }),
    reference: f.reference ?? '',
    amount: amount ?? '',
    amountLine: amount ? t('request.amountLine', { amount }) : '',
    insurance: t(f.insurance === 'rc' ? 'request.insurance.rc' : 'request.insurance.decennale'),
  };
  const subject = t(`request.subject.${f.kind}` as MessageKey, params);
  return {
    to: f.to,
    // A test draft says so, in case someone pastes it into a real e-mail.
    subject: f.isTest ? `${t('chase.testPrefix')}${subject}` : subject,
    body: t(`request.body.${f.kind}` as MessageKey, params),
  };
}
