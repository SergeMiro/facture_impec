// Invoice model: the EN 16931 semantic model (BT-x / BG-x), restricted to what a French SME needs.
// Zod checks the shape only. Whether a field is mandatory or well formed is a validation rule, so the
// user gets a French message pointing at the cell instead of a schema error. That is why fields the
// norm makes mandatory (totals, line amounts…) are optional here: an imported file may lack them.
// computeInvoice() always fills them.
import { z } from 'zod';

const text = z.string();
const opt = text.optional();

/** Amount in integer cents. */
const Cents = z.number().int().refine(Number.isSafeInteger, 'amount out of range');
/** A decimal written as text ("1.5", "20"). Its syntax is checked by FF-FMT-04. */
const DecimalText = text;
/** An ISO date "YYYY-MM-DD". Its syntax is checked by FF-FMT-03. */
const DateText = text;

export const Identifier = z.object({ id: text, scheme: opt });

export const Address = z.object({
  line1: opt, // BT-35 / BT-50 / BT-75
  line2: opt, // BT-36 / BT-51 / BT-76
  line3: opt, // BT-162 / BT-163 / BT-165
  city: opt, // BT-37 / BT-52 / BT-77
  postCode: opt, // BT-38 / BT-53 / BT-78
  subdivision: opt, // BT-39 / BT-54 / BT-79
  country: opt, // BT-40 / BT-55 / BT-80, ISO 3166-1 alpha-2
});

export const Contact = z.object({ name: opt, phone: opt, email: opt }); // BG-6 / BG-9

export const Party = z.object({
  name: opt, // BT-27 / BT-44
  tradingName: opt, // BT-28 / BT-45
  ids: z.array(Identifier).default([]), // BT-29 / BT-46 (SIRET = scheme 0009)
  legalId: Identifier.optional(), // BT-30 / BT-47 (SIREN = scheme 0002)
  vatId: opt, // BT-31 / BT-48
  taxRegistrationId: opt, // BT-32, seller only (franchise seller without VAT number: SIREN)
  legalInfo: opt, // BT-33, seller only
  electronicAddress: Identifier.optional(), // BT-34 / BT-49 (scheme 0225 in France)
  address: Address.optional(), // BG-5 / BG-8
  contact: Contact.optional(),
});

export const Note = z.object({ subjectCode: opt, text }); // BG-1: BT-21, BT-22

export const PrecedingInvoice = z.object({ number: opt, issueDate: opt }); // BG-3: BT-25, BT-26

export const Period = z.object({ start: opt, end: opt }); // BG-14 / BG-26

/**
 * Not EN 16931: the building-trade facts no BT carries (docs/research/BTP_RULES.md), as the company's
 * sheet gives them. The BTP rules read them; the XML shows them only as the notes ABU and AAI.
 */
export const BtpFacts = z.object({
  /** The retenue de garantie held on this invoice: its rate (basis points, 500 = 5 %), its amount. */
  retenue: z
    .object({ rateBps: z.number().int().min(0).optional(), amount: Cents.optional() })
    .optional(),
  /** A situation de travaux: its number in its chantier (BT-11), the cumulative works HT. */
  situation: z.object({ number: z.number().int().min(1), cumulative: Cents.optional() }).optional(),
});

export const AllowanceCharge = z.object({
  amount: Cents.optional(), // BT-92 / BT-99 / BT-136 / BT-141
  baseAmount: Cents.optional(), // BT-93 / BT-100 / BT-137 / BT-142
  percentage: DecimalText.optional(), // BT-94 / BT-101 / BT-138 / BT-143
  vatCategory: opt, // BT-95 / BT-102 (document level only)
  vatRate: DecimalText.optional(), // BT-96 / BT-103 (document level only)
  reason: opt, // BT-97 / BT-104 / BT-139 / BT-144
  reasonCode: opt, // BT-98 / BT-105 / BT-140 / BT-145
});

export const Line = z.object({
  id: opt, // BT-126
  note: opt, // BT-127
  quantity: DecimalText.optional(), // BT-129
  unitCode: opt, // BT-130, UN/ECE Rec 20/21
  netAmount: Cents.optional(), // BT-131
  orderLineRef: opt, // BT-132
  period: Period.optional(), // BG-26
  allowances: z.array(AllowanceCharge).default([]), // BG-27
  charges: z.array(AllowanceCharge).default([]), // BG-28
  price: z.object({
    net: DecimalText.optional(), // BT-146
    discount: DecimalText.optional(), // BT-147
    gross: DecimalText.optional(), // BT-148
    baseQuantity: DecimalText.optional(), // BT-149
    baseUnitCode: opt, // BT-150
  }),
  vat: z.object({ category: opt, rate: DecimalText.optional() }), // BG-30: BT-151, BT-152
  item: z.object({
    name: opt, // BT-153
    description: opt, // BT-154
    sellerId: opt, // BT-155
    buyerId: opt, // BT-156
    standardId: Identifier.optional(), // BT-157
    originCountry: opt, // BT-159
  }),
  /** Goods or services, for the BT-23 category check (FF-CAT-01). Ours, never written to the XML. */
  nature: z.enum(['goods', 'services']).optional(),
});

export const VatBreakdown = z.object({
  category: opt, // BT-118
  rate: DecimalText.optional(), // BT-119 (absent for category O)
  taxableAmount: Cents.optional(), // BT-116
  taxAmount: Cents.optional(), // BT-117
  exemptionReason: opt, // BT-120
  exemptionCode: opt, // BT-121 (VATEX)
});

export const Totals = z.object({
  lineTotal: Cents.optional(), // BT-106
  allowanceTotal: Cents.optional(), // BT-107
  chargeTotal: Cents.optional(), // BT-108
  taxExclusive: Cents.optional(), // BT-109
  taxTotal: Cents.optional(), // BT-110
  taxTotalAccountingCurrency: Cents.optional(), // BT-111
  taxInclusive: Cents.optional(), // BT-112
  prepaid: Cents.optional(), // BT-113
  rounding: Cents.optional(), // BT-114
  payable: Cents.optional(), // BT-115
});

export const Invoice = z.object({
  specificationId: opt, // BT-24
  processType: opt, // BT-23 (cadre de facturation: B1, S1, M1…)
  number: opt, // BT-1
  issueDate: DateText.optional(), // BT-2
  typeCode: opt, // BT-3 (380 invoice, 381 credit note, 384 corrective, 386 down payment)
  currency: opt, // BT-5
  vatCurrency: opt, // BT-6
  taxPointDate: DateText.optional(), // BT-7
  /** BT-8 by meaning; the code depends on the syntax (VAT_DUE_CODES). 'invoice' = TVA sur les débits. */
  vatDueOn: z.enum(['invoice', 'delivery', 'payment']).optional(),
  dueDate: DateText.optional(), // BT-9
  buyerReference: opt, // BT-10
  projectReference: opt, // BT-11
  contractReference: opt, // BT-12
  purchaseOrderReference: opt, // BT-13
  salesOrderReference: opt, // BT-14
  paymentTerms: opt, // BT-20
  notes: z.array(Note).default([]), // BG-1
  precedingInvoices: z.array(PrecedingInvoice).default([]), // BG-3
  seller: Party, // BG-4
  buyer: Party, // BG-7
  delivery: z
    .object({
      name: opt, // BT-70
      date: DateText.optional(), // BT-72
      address: Address.optional(), // BG-15
    })
    .optional(),
  invoicePeriod: Period.optional(), // BG-14
  payment: z
    .object({
      meansCode: opt, // BT-81
      meansText: opt, // BT-82
      remittanceInfo: opt, // BT-83
      accounts: z
        .array(z.object({ iban: opt, name: opt, bic: opt })) // BG-17: BT-84, BT-85, BT-86
        .default([]),
    })
    .optional(),
  allowances: z.array(AllowanceCharge).default([]), // BG-20
  charges: z.array(AllowanceCharge).default([]), // BG-21
  totals: Totals, // BG-22
  vatBreakdown: z.array(VatBreakdown).default([]), // BG-23
  lines: z.array(Line).default([]), // BG-25
  btp: BtpFacts.optional(),
});

export type Identifier = z.infer<typeof Identifier>;
export type Address = z.infer<typeof Address>;
export type Contact = z.infer<typeof Contact>;
export type Party = z.infer<typeof Party>;
export type Note = z.infer<typeof Note>;
export type Period = z.infer<typeof Period>;
export type AllowanceCharge = z.infer<typeof AllowanceCharge>;
export type Line = z.infer<typeof Line>;
export type VatBreakdown = z.infer<typeof VatBreakdown>;
export type Totals = z.infer<typeof Totals>;
export type Invoice = z.infer<typeof Invoice>;
export type BtpFacts = z.infer<typeof BtpFacts>;
/** What a user or the mapping step provides: line amounts, totals and the VAT breakdown are computed. */
export const InvoiceDraft = Invoice.omit({
  totals: true,
  vatBreakdown: true,
  specificationId: true,
}).extend({
  lines: z.array(Line.omit({ netAmount: true })).default([]),
  /** BT-120 / BT-121 per VAT category, copied into the computed breakdown. */
  vatExemptions: z.array(z.object({ category: text, code: opt, reason: opt })).default([]),
  /** Amount already paid (BT-113). */
  prepaid: Cents.optional(),
  /** VAT total in the VAT accounting currency (BT-111), when BT-6 differs from BT-5. */
  taxTotalAccountingCurrency: Cents.optional(),
});
export type InvoiceDraft = z.input<typeof InvoiceDraft>;
export type InvoiceInput = z.input<typeof Invoice>;

/** BT-8 codes: UNTDID 2475 in CII, UNTDID 2005 in UBL (CEN code lists, FR_RULES Q1d). */
export const VAT_DUE_CODES = {
  invoice: { cii: '5', ubl: '3' },
  delivery: { cii: '29', ubl: '35' },
  payment: { cii: '72', ubl: '432' },
} as const;
export type VatDueOn = keyof typeof VAT_DUE_CODES;

export const EN16931_SPECIFICATION = 'urn:cen.eu:en16931:2017';
