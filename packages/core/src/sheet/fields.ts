// The columns a sheet can provide, and the mapping MappingAgent (or the user) gives them (plan §6).
import { z } from 'zod';
import type { Address } from '../model';
import { ColumnLetters } from './cells';

export const INVOICE_FIELDS = [
  'number',
  'issueDate',
  'dueDate',
  'deliveryDate',
  'buyerName',
  'buyerSiren',
  'buyerSiret',
  'buyerVatId',
  'buyerEmail',
  'buyerAddress',
  'buyerPostCode',
  'buyerCity',
  'buyerCountry',
  'purchaseOrder',
  'paymentTerms',
  'currency',
  'itemName',
  'itemRef',
  'quantity',
  'unitCode',
  'unitPrice',
  'lineNet',
  'lineDiscount',
  'lineDiscountPercent',
  'vatRate',
  'vatCategory',
  'nature',
  'totalInclVat',
] as const;
export type InvoiceField = (typeof INVOICE_FIELDS)[number];

/** The 8 fields the MappingAgent eval scores (plan §9: ≥ 95 %). */
export const CORE_FIELDS = [
  'number',
  'issueDate',
  'buyerName',
  'buyerSiren',
  'itemName',
  'quantity',
  'unitPrice',
  'vatRate',
] as const satisfies readonly InvoiceField[];

/** Read once per invoice, on the first row of its group; the other fields are read on every line. */
export const INVOICE_LEVEL_FIELDS: ReadonlySet<InvoiceField> = new Set([
  'number',
  'issueDate',
  'dueDate',
  'deliveryDate',
  'buyerName',
  'buyerSiren',
  'buyerSiret',
  'buyerVatId',
  'buyerEmail',
  'buyerAddress',
  'buyerPostCode',
  'buyerCity',
  'buyerCountry',
  'purchaseOrder',
  'paymentTerms',
  'currency',
]);

/** Below this, a proposed column is shown as « à confirmer » (plan §6 guardrail). */
export const CONFIRM_BELOW = 0.8;

export const FieldMapping = z.object({
  column: ColumnLetters,
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean().default(false),
});

export const SheetMapping = z.object({
  sheet: z.string().min(1),
  headerRow: z.number().int().positive(),
  mapping: z.partialRecord(z.enum(INVOICE_FIELDS), FieldMapping),
  /** Multi-line invoices: rows sharing this column's value are one invoice; blank continues the last. */
  grouping: z.object({ by: ColumnLetters }).nullable(),
  /** Plain French notes for the user (missing columns, doubts). */
  warnings: z.array(z.string()).default([]),
  /** Who proposed it: the agent, the dictionary fallback, or the user after editing. */
  source: z.enum(['agent', 'heuristic', 'user']).default('heuristic'),
});

export type FieldMapping = z.infer<typeof FieldMapping>;
export type SheetMapping = z.infer<typeof SheetMapping>;
export type SheetMappingInput = z.input<typeof SheetMapping>;

/**
 * What the tenant sets once (Réglages) and every invoice of the sheet reuses. Never guessed: what is
 * missing here stays missing on the invoice, and a core rule says so.
 */
export const InvoiceDefaults = z.object({
  siret: z.string().optional(),
  iban: z.string().optional(),
  bic: z.string().optional(),
  /** UNTDID 4461; 30 = virement. */
  paymentMeansCode: z.string().default('30'),
  /** Due date when the sheet has none: issue date + this many days. */
  paymentDays: z.number().int().min(0).max(365).optional(),
  paymentTerms: z.string().optional(),
  /** BT-23 « catégorie de l'opération »: B1 goods, S1 services, M1 both. */
  operationCategory: z.enum(['goods', 'services', 'mixed']).optional(),
  currency: z.string().default('EUR'),
  /** Mentions obligatoires (PMT, PMD, AAB); the defaults are the legal minimum wording. */
  recoveryFeeNote: z.string().optional(),
  latePenaltyNote: z.string().optional(),
  discountNote: z.string().optional(),
});
export type InvoiceDefaults = z.infer<typeof InvoiceDefaults>;
export type InvoiceDefaultsInput = z.input<typeof InvoiceDefaults>;

/** The seller side of every invoice: the tenant. */
export interface SellerProfile {
  name: string;
  siren: string;
  vatId?: string | null;
  address?: Address | null;
  defaults: InvoiceDefaultsInput;
}
