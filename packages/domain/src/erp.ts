// The lists an ERP gives (docs/DECISIONS.md D9) and why one of their rows is not imported: the
// connectors read them, the pane words them (`erp.list.*`, `erp.skip.*` in fr.json).

/** What a file lists: one entity, and for companies, which side. */
export const EXPORT_LISTS = [
  'customers',
  'suppliers',
  'chantiers',
  'invoices',
  'payments',
] as const;
export type ExportList = (typeof EXPORT_LISTS)[number];

/** Why a row was not imported. */
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
