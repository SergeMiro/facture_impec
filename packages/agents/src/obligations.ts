// What a document becomes once its kind is known (BTP plan §7 `linkParties` and `deriveObligations`,
// `docs/DECISIONS.md` D7): its company, the deadlines it makes, the question to ask about an
// unknown company, or why a person must look. No model and no database here: the caller reads the
// company's parties and writes the result in one transaction.
import { addMonths } from '@fi/core';
import {
  DEADLINE_DATE,
  type DocumentKind,
  INVOICE_KINDS,
  type ObligationKind,
  STANDING_KINDS,
} from '@fi/domain';
import type { ClassifyLabel } from './classify';
import type { DocumentFields } from './document-fields';

/** Why a person must look at a document (stage 2's; stage 1's are the reading's own). */
export const REVIEW_REASONS = [
  'unclassified',
  'invoice_without_data',
  'dates_missing',
  'party_unclear',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/**
 * A sale when the company's SIREN is the only one named; a purchase otherwise (the usual case). A
 * kind a person gave is kept as it is.
 */
export function kindOf(
  label: ClassifyLabel | DocumentKind,
  sirens: readonly string[],
  own: string,
): DocumentKind {
  if (label !== 'facture') return label;
  return sirens.length > 0 && sirens.every((s) => s === own) ? 'facture_vente' : 'facture_achat';
}

/**
 * The deadline of a sale, whichever source brings it (the PDP, an ERP, the mail): the seller's SIREN
 * and the invoice's number (D7, D9).
 */
export const saleDeadlineKey = (sellerSiren: string, number: string, isTest: boolean) =>
  `${isTest ? 'test:' : ''}facture_echeance:${sellerSiren}:${number}`;

export interface ObligationDraft {
  kind: ObligationKind;
  /** Unique per company: the same deadline from another copy or source finds this one. */
  key: string;
  dueOn: string;
  amount: number | null;
  /** The company it concerns, when the document named one. */
  siren: string | null;
}

/** An invoice read from its XML (stage 1), as far as a deadline needs it. */
export interface InvoiceFacts {
  number: string;
  sellerSiren: string | null;
  dueDate: string | null;
  payable: number;
}

export interface DeriveInput {
  documentId: string;
  kind: DocumentKind;
  fields: Pick<DocumentFields, 'issuedOn' | 'validTo' | 'receptionOn'>;
  /** Whose document it is (the subcontractor of an attestation); null when none was found. */
  siren: string | null;
  invoice?: InvoiceFacts | undefined;
  isTest: boolean;
}

/**
 * kind → deadline (D7): an attestation and a Kbis every six months (C. trav. D8222-5,
 * TODO(verify) on Légifrance), an insurance at its end, the retenue a year after the réception
 * (loi n° 71-584, art. 2), a sale at its due date. A Mode test key starts with `test:`.
 */
export function deriveObligations(input: DeriveInput): ObligationDraft[] {
  const { kind, fields, siren } = input;
  const key = (...parts: string[]) => `${input.isTest ? 'test:' : ''}${parts.join(':')}`;
  const one = (o: ObligationDraft) => [o];
  switch (kind) {
    case 'attestation_vigilance':
      if (!fields.issuedOn || !siren) return [];
      return one({
        kind: 'attestation_vigilance_renouvellement',
        key: key('attestation_vigilance_renouvellement', siren),
        dueOn: addMonths(fields.issuedOn, 6),
        amount: null,
        siren,
      });
    case 'kbis':
      if (!fields.issuedOn || !siren) return [];
      return one({
        kind: 'kbis_renouvellement',
        key: key('kbis_renouvellement', siren),
        dueOn: addMonths(fields.issuedOn, 6),
        amount: null,
        siren,
      });
    case 'attestation_assurance_decennale':
    case 'attestation_assurance_rc':
      if (!fields.validTo || !siren) return [];
      return one({
        kind: 'assurance_expiration',
        key: key(
          'assurance_expiration',
          siren,
          kind === 'attestation_assurance_decennale' ? 'decennale' : 'rc',
        ),
        dueOn: fields.validTo,
        amount: null,
        siren,
      });
    case 'pv_reception':
      if (!fields.receptionOn) return [];
      return one({
        kind: 'retenue_garantie_liberation',
        key: key('retenue_garantie_liberation', input.documentId),
        dueOn: addMonths(fields.receptionOn, 12),
        amount: null,
        siren,
      });
    case 'facture_vente': {
      const inv = input.invoice;
      if (!inv?.number || !inv.dueDate || !inv.sellerSiren || inv.payable <= 0) return [];
      return one({
        kind: 'facture_echeance',
        key: saleDeadlineKey(inv.sellerSiren, inv.number, input.isTest),
        dueOn: inv.dueDate,
        amount: inv.payable,
        siren: siren,
      });
    }
    default:
      return [];
  }
}

export interface SettleInput {
  documentId: string;
  /** The classifier's label, or the kind a person gave. */
  label: ClassifyLabel | DocumentKind;
  fields: DocumentFields;
  /** The company's own SIREN. */
  own: string;
  /** The company's parties among the SIRENs named: SIREN → party id. */
  parties: ReadonlyMap<string, string>;
  isTest: boolean;
}

export interface Settled {
  kind: DocumentKind;
  stage: 'done' | 'needs_review';
  reviewReason: ReviewReason | null;
  /** The company of the document, when it is one of the company's parties. */
  partyId: string | null;
  /** Whose document it is, by SIREN, known or not. */
  siren: string | null;
  obligations: ObligationDraft[];
  /** A SIREN the company does not know yet, to confirm (`confirmer_tiers`). */
  confirm: string | null;
}

/**
 * Whose document it is: a known party first, then the one other SIREN named, then the company
 * itself (its own attestation renews too). Several unknown ones: nobody can tell.
 */
function subjectOf(input: SettleInput): { siren: string | null; unclear: boolean } {
  const others = input.fields.sirens.filter((s) => s !== input.own);
  const known = others.find((s) => input.parties.has(s));
  if (known) return { siren: known, unclear: false };
  if (others.length === 1) return { siren: others[0] ?? null, unclear: false };
  if (others.length > 1) return { siren: null, unclear: true };
  return { siren: input.fields.sirens.includes(input.own) ? input.own : null, unclear: false };
}

/** The end of a text document's way through stage 2: done, or a person's question. */
export function settleDocument(input: SettleInput): Settled {
  const kind = kindOf(input.label, input.fields.sirens, input.own);
  const { siren, unclear } = subjectOf(input);
  const partyId = siren ? (input.parties.get(siren) ?? null) : null;
  const base = { kind, partyId, siren, obligations: [], confirm: null };
  const review = (reviewReason: ReviewReason): Settled => ({
    ...base,
    stage: 'needs_review',
    reviewReason,
  });

  // An invoice without its XML: reading its amounts waits for the owner (D7).
  if (INVOICE_KINDS.includes(kind)) {
    return review('invoice_without_data');
  }
  if (STANDING_KINDS.includes(kind) && (!siren || unclear)) return review('party_unclear');
  const date = DEADLINE_DATE[kind];
  if (date && !input.fields[date]) return review('dates_missing');

  const obligations = deriveObligations({
    documentId: input.documentId,
    kind,
    fields: input.fields,
    siren,
    isTest: input.isTest,
  });
  return {
    ...base,
    stage: 'done',
    reviewReason: null,
    obligations,
    // Whose standing it proves, unknown to the company: it confirms the new sous-traitant.
    confirm:
      STANDING_KINDS.includes(kind) && siren && !partyId && siren !== input.own ? siren : null,
  };
}
