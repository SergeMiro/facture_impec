// Types TS miroir du modèle Rust `facture-core` (cf. crates/facture-core/src/model.rs).
// Les montants sont des chaînes ("1000.00") pour préserver la précision décimale au passage JSON → Rust.

export type Severity = "hard" | "soft";

export interface Issue {
  code: string;
  severity: Severity;
  field: string;
  cell_ref?: string | null;
  message_fr: string;
}

export interface ValidationReport {
  issues: Issue[];
  is_sendable: boolean;
}

export type VatCategory = "S" | "Z" | "E" | "AE" | (string & {});

export interface Address {
  line1?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country_code?: string | null;
}

export interface Party {
  name?: string | null;
  siren?: string | null;
  siret?: string | null;
  vat_id?: string | null;
  address?: Address;
}

export interface Line {
  id?: string | null;
  description?: string | null;
  quantity?: string | null;
  unit?: string | null;
  unit_price?: string | null;
  line_amount?: string | null;
  vat_rate?: string | null;
  vat_category?: VatCategory | null;
}

export interface VatBreakdown {
  category?: VatCategory | null;
  rate?: string | null;
  taxable_amount?: string | null;
  tax_amount?: string | null;
  exemption_reason_code?: string | null;
  exemption_reason_text?: string | null;
}

export interface Totals {
  line_extension_amount?: string | null;
  tax_exclusive_amount?: string | null;
  tax_amount?: string | null;
  tax_inclusive_amount?: string | null;
  paid_amount?: string | null;
  rounding_amount?: string | null;
  payable_amount?: string | null;
}

export interface Payment {
  iban?: string | null;
  bic?: string | null;
  terms?: string | null;
}

export interface Invoice {
  invoice_number?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  type_code?: string | null;
  currency?: string | null;
  seller: Party;
  buyer: Party;
  lines: Line[];
  vat_breakdown: VatBreakdown[];
  totals: Totals;
  payment?: Payment;
  /** chemin de champ → référence de cellule (rempli par l'add-in Excel pour le surlignage). */
  cells?: Record<string, string>;
}
