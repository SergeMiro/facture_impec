// Checks of documents together (R2): what the Linker and the Checker read and what they answer. Plain
// data: the API loads it from the registry and writes the links and findings back
// (apps/api/src/checks.ts). A finding is always a rule here, with its money at stake and its cells;
// no model decides one.
import type { DocKind } from '../layout';

export const CHECK_RULES = [
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
] as const;
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
  'B2.loss',
  'B2.margin',
  'B3.unbilled',
  'B3.unbilledNoAmount',
  'B4.quantity',
  'B4.price',
  'B4.several',
  'B5.lines',
  'B5.total',
  'B6.siren',
  'B6.name',
  'B7.under',
  'B7.over',
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
  'B2.loss': 'blocking',
  // Above the cost, under the margin the company set: money earned, less than it wants.
  'B2.margin': 'warning',
  'B3.unbilled': 'warning',
  'B3.unbilledNoAmount': 'warning',
  'B4.quantity': 'blocking',
  'B4.price': 'blocking',
  'B4.several': 'blocking',
  'B5.lines': 'blocking',
  'B5.total': 'blocking',
  'B6.siren': 'warning',
  'B6.name': 'warning',
  // A price this customer does not usually pay: a mistake, or a price agreed since (R7).
  'B7.under': 'warning',
  'B7.over': 'warning',
};

/**
 * The rules a person may call normal for a customer and an article (« C'est normal », R7): a price
 * agreed with the customer, a thin margin chosen. Never a sum, a VAT rate or a delivery left unbilled.
 */
export const ACCEPTABLE_RULES = [
  'A5',
  'B1',
  'B2',
  'B4',
  'B7',
] as const satisfies readonly CheckRule[];
export type AcceptableRule = (typeof ACCEPTABLE_RULES)[number];

/** Who a finding is about, for « C'est normal »: the customer (`siren:…` or `name:…`) and the article. */
export interface FindingScope {
  party: string | null;
  itemId: string;
}

/** « C'est normal »: this rule stays quiet on this article, for this customer or any (party null). */
export interface RuleException {
  rule: AcceptableRule;
  party: string | null;
  itemId: string;
  /** Europe/Paris ISO date of its last day; null: no end. */
  until: string | null;
}

/**
 * billed_by: an order (or a delivery note) → the invoice that bills it; fulfils: a delivery note → its
 * order; cost: a purchase → the invoice whose sold lines it gives their cost (R3).
 */
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
  /** UN/ECE rec. 20 (« H87 » a piece); a purchase in boxes is no cost for a sale by the piece. */
  unitCode?: string | null;
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
  /** ISO 4217; none is euros (a sheet). */
  currency?: string | null;
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
  role: 'invoice' | 'order' | 'delivery' | 'price_list' | 'history' | 'purchase';
  docId: string;
  number: string | null;
  cell: string | null;
}

/**
 * The one cell the code knows how to correct and to what (R8): an invoice line's price, set to the
 * order's or the price list's. Never a model's value; the pane writes it only after « Appliquer ».
 */
export interface CheckFix {
  /** The price cell, as the sheet reading gives it (`Factures!K2`). */
  cell: string;
  field: 'price';
  /** Decimal text the cell held when checked: « 30 ». */
  before: string;
  /** Decimal text it should hold, in euros: « 40 ». */
  after: string;
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
  /** Present when one price cell corrects it (R8). */
  fix?: CheckFix;
  /** Present when the person may call it normal (R7). */
  scope?: FindingScope;
  /** The invoice bills less than it should: money not invoiced, for the weekly report (R7). */
  short?: true;
}

/** Two articles that are one (R7): `aliasId` is read as `itemId`. */
export interface SynonymDecision {
  itemId: string;
  aliasId: string;
  status: 'confirmed' | 'rejected';
}

/** « Est-ce le même article ? »: a sold article with no cost, and a bought one whose name looks like it. */
export interface SynonymProposal {
  /** The article sold. */
  itemId: string;
  /** The article bought. */
  aliasId: string;
  itemName: string;
  aliasName: string;
  /** 0–100. */
  score: number;
}

export interface CheckInput {
  docs: readonly CheckDoc[];
  decisions: readonly LinkDecision[];
  /** Europe/Paris, ISO. */
  today: string;
  /** The margin the company wants on what it resells, in % of the sale price (Réglages); null: none. */
  minMarginPercent?: number | null;
  /** « C'est normal » answers still running (R7). */
  exceptions?: readonly RuleException[];
  /** A person's yes or no on two articles being one (R7). */
  synonyms?: readonly SynonymDecision[];
}

export interface CheckOutput {
  links: Link[];
  /** Largest amount first. */
  findings: CheckFinding[];
  /** Pairs of articles to ask about, best first. */
  synonyms: SynonymProposal[];
}
