// The closed lists of the BTP back end (BTP plan §4, docs/DECISIONS.md D2). Postgres keeps each one
// too (a check constraint in @fi/db): adding a value is a migration, never a string typed somewhere.
import { z } from 'zod';

/** What a received or sent document is, once classified (BTP plan §4 `document.kind`). */
export const DOCUMENT_KINDS = [
  'facture_achat',
  'facture_vente',
  'situation',
  'avoir',
  'devis',
  'contrat_sous_traitance',
  'contrat_travail',
  'attestation_vigilance',
  'kbis',
  'attestation_assurance_decennale',
  'attestation_assurance_rc',
  'liste_salaries_etrangers',
  'pv_reception',
  'dgd',
  'autre',
] as const;
export const DocumentKind = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof DocumentKind>;

/** The kinds that are invoices: they are read into the registry and checked by the rules. */
export const INVOICE_KINDS: readonly DocumentKind[] = [
  'facture_achat',
  'facture_vente',
  'situation',
  'avoir',
];

/** The kinds that prove a company's standing: each renews, and needs to know whose it is (D7). */
export const STANDING_KINDS: readonly DocumentKind[] = [
  'attestation_vigilance',
  'kbis',
  'attestation_assurance_decennale',
  'attestation_assurance_rc',
];

/** The date a kind's deadline counts from (D7): read from the document, or given by a person. */
export const DEADLINE_DATE: Partial<Record<DocumentKind, 'issuedOn' | 'validTo' | 'receptionOn'>> =
  {
    attestation_vigilance: 'issuedOn',
    kbis: 'issuedOn',
    attestation_assurance_decennale: 'validTo',
    attestation_assurance_rc: 'validTo',
    pv_reception: 'receptionOn',
  };

/** Where a document came from (BTP plan §5). `excel` is the task pane, in Excel or Google Sheets. */
export const DOCUMENT_SOURCES = ['mail', 'drive', 'pdp', 'excel', 'erp'] as const;
export const DocumentSource = z.enum(DOCUMENT_SOURCES);
export type DocumentSource = z.infer<typeof DocumentSource>;

/**
 * How far a document went (BTP plan §7 `DocumentState.stage`): ingested (stored, text read), then
 * classified, extracted, validated, linked to its company and chantier, done; or needs review when a
 * person must say what it is. A second copy of a file is not a stage: it joins the first one.
 */
export const DOCUMENT_STAGES = [
  'ingested',
  'classified',
  'extracted',
  'validated',
  'linked',
  'done',
  'needs_review',
] as const;
export const DocumentStage = z.enum(DOCUMENT_STAGES);
export type DocumentStage = z.infer<typeof DocumentStage>;

/** A deadline the back end watches (BTP plan §4 `obligation.kind`). */
export const OBLIGATION_KINDS = [
  /** A sous-traitant's URSSAF attestation, every six months (C. trav. D8222-5). */
  'attestation_vigilance_renouvellement',
  'kbis_renouvellement',
  'assurance_expiration',
  'facture_echeance',
  'situation_echeance',
  /** One year after the réception (loi n° 71-584 du 16 juillet 1971, art. 2). */
  'retenue_garantie_liberation',
  'tva_declaration',
  'contrat_fin',
] as const;
export const ObligationKind = z.enum(OBLIGATION_KINDS);
export type ObligationKind = z.infer<typeof ObligationKind>;

export const OBLIGATION_STATUSES = ['open', 'done', 'dismissed'] as const;
export const ObligationStatus = z.enum(OBLIGATION_STATUSES);
export type ObligationStatus = z.infer<typeof ObligationStatus>;

/**
 * What an action proposes. Every one that writes to someone outside the company waits for a
 * person's approval (BTP plan §2: nothing goes out without it); `confirmer_tiers` asks the company
 * itself whether an unknown SIRET is a new supplier or customer.
 */
export const ACTION_KINDS = [
  'relance_facture',
  'relance_situation',
  'demande_attestation_vigilance',
  'demande_kbis',
  'demande_attestation_assurance',
  'demande_liberation_retenue',
  'confirmer_tiers',
] as const;
export const ActionKind = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof ActionKind>;

/**
 * draft: waiting for a decision; snoozed: hidden until `snooze_until`, then a draft again;
 * approved: on its way out; sent; rejected; failed (the check before sending refused it, or the
 * channel did). Only a decision moves a draft (docs/DECISIONS.md D2).
 */
export const ACTION_STATUSES = [
  'draft',
  'snoozed',
  'approved',
  'rejected',
  'sent',
  'failed',
] as const;
export const ActionStatus = z.enum(ACTION_STATUSES);
export type ActionStatus = z.infer<typeof ActionStatus>;
