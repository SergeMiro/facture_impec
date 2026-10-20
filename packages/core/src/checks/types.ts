// Checks of documents together (R2): what the Linker and the Checker read and what they answer. Plain
// data: the API loads it from the registry and writes the links and findings back
// (apps/api/src/checks.ts). A finding is always a rule here, with its money at stake and its cells;
// no model decides one.
import type { DocKind } from '../layout';

export const CHECK_RULES = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B3', 'B4', 'B5', 'B6'] as const;
export type CheckRule = (typeof CHECK_RULES)[number];

/** blocking: the autopilot stops and « Envoyer » asks « Envoyer quand même »; warning: to read. */
export const FINDING_SEVERITIES = ['blocking', 'warning', 'info'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Each finding's wording (fr.json `check.message.*`), the rule first. */
export const CHECK_MESSAGES = [
  'A1.sheet',
  'A1.order',
  'A1.price',
  'A2.line',
  'A2.total',
  'A3.twice',
  'A3.percent',
  'A3.reference',
  'A4.rate',
  'A5.price',
  'B1.under',
  'B1.several',
  'B3.unbilled',
  'B3.unbilledNoAmount',
  'B4.quantity',
  'B4.price',
  'B4.several',
  'B5.lines',
  'B5.total',
  'B6.siren',
  'B6.name',
] as const;
export type CheckMessage = (typeof CHECK_MESSAGES)[number];

export const ruleOf = (message: CheckMessage) => message.slice(0, 2) as CheckRule;

export const SEVERITY: Readonly<Record<CheckMessage, FindingSeverity>> = {
  // The sheet's amount column holds TTC: the electronic invoice still uses quantity × price.
  'A1.sheet': 'warning',
  'A1.order': 'warning',
  // The invoice itself would charge the VAT twice.
  'A1.price': 'blocking',
  // The sheet and the invoice disagree on an amount, and no formula says which one is right.
  'A2.line': 'blocking',
  'A2.total': 'blocking',
  'A3.twice': 'blocking',
  'A3.percent': 'blocking',
  'A3.reference': 'blocking',
  'A4.rate': 'warning',
  // A lower price is often a discount the company granted.
  'A5.price': 'warning',
  'B1.under': 'blocking',
  'B1.several': 'blocking',
  'B3.unbilled': 'warning',
  'B3.unbilledNoAmount': 'warning',
  'B4.quantity': 'blocking',
  'B4.price': 'blocking',
  'B4.several': 'blocking',
  'B5.lines': 'blocking',
  'B5.total': 'blocking',
  'B6.siren': 'warning',
  'B6.name': 'warning',
};

/** billed_by: an order (or a delivery note) → the invoice that bills it; fulfils: a delivery note → its order; cost: R3. */
export const LINK_KINDS = ['billed_by', 'fulfils', 'cost'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_METHODS = ['number', 'item', 'similarity', 'agent', 'human'] as const;
export type LinkMethod = (typeof LINK_METHODS)[number];
/** auto and confirmed links are read by the rules; proposed ones wait for a person. */
export const LINK_STATUSES = ['auto', 'proposed', 'confirmed', 'rejected'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/** A1–A3 found where the invoice's own sheet is read (src/sheet/build.ts), kept with the invoice. */
export interface SheetCheck {
  rule: 'A1' | 'A2' | 'A3';
  message: CheckMessage;
  cell: string;
  amount: number | null;
  params: Record<string, string>;
}

export interface CheckLine {
  position: number;
  itemId: string | null;
  name: string | null;
  /** Decimal text. */
  quantity: string | null;
  /** Decimal text, before the line's discount. */
  netPrice: string | null;
  /** Cents, after the discount. */
  netAmount: number | null;
  /** Cents. */
  discount: number | null;
  vatRate: string | null;
  /** The cell of the designation; of the price and of the rate when the invoice's sheet maps them. */
  cell: string | null;
  priceCell?: string | null;
  rateCell?: string | null;
}

export interface CheckDoc {
  id: string;
  direction: 'out' | 'in';
  kind: 'invoice' | DocKind;
  /** 380 invoice, 381 credit note, 386 advance (prepayment) invoice. */
  typeCode: string | null;
  isTest: boolean;
  number: string | null;
  issueDate: string | null;
  partySiren: string | null;
  partyName: string | null;
  /** On an invoice the order it bills (BT-13); on a delivery note the order it delivers. */
  orderRef: string | null;
  /** Cents. */
  netTotal: number | null;
  /** The part of the net total already paid by advances (BT-113 brought to HT), cents. */
  prepaid: number | null;
  invoiceId: string | null;
  /** Already on its way or sent: a finding goes on an invoice that can still change when there is one. */
  locked: boolean;
  /** The sheet that holds it, for the wording (« Tarifs »). */
  sheet: string | null;
  lines: CheckLine[];
  sheetChecks?: SheetCheck[];
}

export interface LinkDecision {
  kind: LinkKind;
  fromDocId: string;
  toDocId: string;
  status: 'confirmed' | 'rejected';
}

export interface Link {
  kind: LinkKind;
  fromDocId: string;
  toDocId: string;
  /** 0–100. */
  score: number;
  method: LinkMethod;
  status: LinkStatus;
}

export interface Evidence {
  role: 'invoice' | 'order' | 'delivery' | 'price_list' | 'history';
  docId: string;
  number: string | null;
  cell: string | null;
}

export interface CheckFinding {
  rule: CheckRule;
  severity: FindingSeverity;
  message: CheckMessage;
  /** The document it is about: an invoice, or the order or delivery note itself. */
  docId: string;
  /** Who it is: the same mistake keeps its key while its amounts change. */
  key: string;
  /** Cents at stake; null when nothing tells the amount. */
  amount: number | null;
  /** The wording's values, already written in French. */
  params: Record<string, string>;
  evidence: Evidence[];
}

export interface CheckInput {
  docs: readonly CheckDoc[];
  decisions: readonly LinkDecision[];
  /** Europe/Paris, ISO. */
  today: string;
}

export interface CheckOutput {
  links: Link[];
  /** Largest amount first. */
  findings: CheckFinding[];
}
