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

/** A chantier: its ERP code is the key, its customer found by code, SIREN or name. */
export const ChantierRow = z.object({
  row: z.number().int().positive(),
  code: text(100),
  name: text(200),
  customer: z
    .object({
      code: text(100).optional(),
      siren: Siren.optional(),
      name: text(200).optional(),
    })
    .optional(),
  address: ErpAddress.optional(),
  /** Undefined: the export does not say, and a chantier already known keeps its status. */
  status: z.enum(['open', 'closed']).optional(),
  receptionOn: IsoDate.optional(),
  reservesLiftedOn: IsoDate.optional(),
  /** Basis points: 500 = 5 %, the most loi 71-584 art. 1 allows. */
  retenueBps: z.number().int().min(0).max(500).optional(),
});
export type ChantierRow = z.infer<typeof ChantierRow>;

/** Why a row was not imported; `erp.skip.*` in fr.json words each. */
export const SKIP_REASONS = [
  'no_siren',
  'siren_invalid',
  'no_name',
  'no_code',
  'duplicate',
  'invalid',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface Skipped {
  row: number;
  /** The name the row gives, to find it in the ERP. */
  name: string | null;
  reason: SkipReason;
}
