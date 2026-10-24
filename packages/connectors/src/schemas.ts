// One schema per entity row (BTP plan §9 « каждая строка проходит Zod-схему »), whichever connector
// read it: what the shared mapping may rely on. A row that does not pass is skipped with its reason,
// never written half.
import { isValidSiren, isValidSiret } from '@fi/core';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const IsoDate = z.iso.date();

export const Siren = z.string().refine(isValidSiren);
export const Siret = z.string().refine(isValidSiret);

export const ErpAddress = z.object({
  line1: text(200).optional(),
  line2: text(200).optional(),
  postCode: text(20).optional(),
  city: text(100).optional(),
  /** ISO 3166-1 alpha-2. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
export type ErpAddress = z.infer<typeof ErpAddress>;

/** A customer or a supplier: its SIREN is the key (D9), its ERP code kept as `erp_ref`. */
export const TiersRow = z.object({
  /** The row of the file (or the record's place in the ERP's answer), to say which was skipped. */
  row: z.number().int().positive(),
  code: text(100).optional(),
  name: text(200),
  siren: Siren,
  siret: Siret.optional(),
  email: z.email().max(254).optional(),
  address: ErpAddress.optional(),
  /** Said by the ERP: a supplier that works as the company's sous-traitant. */
  subcontracting: z.boolean().optional(),
});
export type TiersRow = z.infer<typeof TiersRow>;

/** Who a row names: by the ERP's code, a SIREN, or a name. */
const PartyRef = z.object({
  code: text(100).optional(),
  siren: Siren.optional(),
  name: text(200).optional(),
});
export type PartyRef = z.infer<typeof PartyRef>;

/** A chantier: its ERP code is the key, its customer found by code, SIREN or name. */
export const ChantierRow = z.object({
  row: z.number().int().positive(),
  code: text(100),
  name: text(200),
  customer: PartyRef.optional(),
  address: ErpAddress.optional(),
  /** Undefined: the export does not say, and a chantier already known keeps its status. */
  status: z.enum(['open', 'closed']).optional(),
  receptionOn: IsoDate.optional(),
  reservesLiftedOn: IsoDate.optional(),
  /** Basis points: 500 = 5 %, the most loi 71-584 art. 1 allows. */
  retenueBps: z.number().int().min(0).max(500).optional(),
});
export type ChantierRow = z.infer<typeof ChantierRow>;

const Cents = z.number().int().safe();

/**
 * A sale or a situation the company invoiced (stage 4B): its number is the key, with the company's
 * SIREN, of the same deadline the PDP and the mail make. An avoir, a devis, a pro forma never get
 * here: they are skipped with their reason.
 */
export const FactureRow = z.object({
  row: z.number().int().positive(),
  number: text(100),
  kind: z.enum(['facture', 'situation']),
  issuedOn: IsoDate.optional(),
  dueOn: IsoDate,
  customer: PartyRef.optional(),
  chantier: z.object({ code: text(100).optional(), name: text(200).optional() }).optional(),
  /** TTC, in cents. */
  total: Cents.positive().optional(),
  /** What is left to pay, in cents: 0 once paid. */
  left: Cents.nonnegative().optional(),
});
export type FactureRow = z.infer<typeof FactureRow>;

/** A payment of one invoice, by its number (stage 4B). */
export const ReglementRow = z.object({
  row: z.number().int().positive(),
  invoice: text(100),
  paidOn: IsoDate.optional(),
  amount: Cents.positive(),
  mode: text(100).optional(),
  reference: text(100).optional(),
});
export type ReglementRow = z.infer<typeof ReglementRow>;

/** Why a row was not imported; `erp.skip.*` in fr.json words each. */
export const SKIP_REASONS = [
  'no_siren',
  'siren_invalid',
  'no_name',
  'no_code',
  'duplicate',
  'invalid',
  // Invoices and payments (stage 4B).
  'no_number',
  'no_due_date',
  'no_amount',
  'credit_note',
  'not_invoice',
  'paid',
  'sent_here',
  'invoice_unknown',
  'partial_payment',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface Skipped {
  row: number;
  /** The name the row gives, to find it in the ERP. */
  name: string | null;
  reason: SkipReason;
}
