import type { Invoice } from '../model';

export type Severity = 'error' | 'warning';
/** Who wrote the rule: CEN (EN 16931), AFNOR (French CIUS, BR-FR-*), the DGFiP (G*), or us (FF-*). */
export type Source = 'EN16931' | 'AFNOR' | 'DGFIP' | 'FF';
/** Which part of the invoice the rule looks at, to group messages in the add-in. */
export type Scope =
  | 'document'
  | 'seller'
  | 'buyer'
  | 'lines'
  | 'vat'
  | 'totals'
  | 'payment'
  | 'delivery'
  | 'notes';

export type Params = Readonly<Record<string, string | number>>;

/** What a check returns: where the problem is. The engine turns it into a French message. */
export interface Finding {
  /** Path in the invoice model, e.g. `lines[2].vat.rate`. The add-in maps it to a cell. */
  path: string;
  params?: Params;
  /** Picks `rule.<id>.<variant>.message` when one rule has several wordings (BR-FR-05). */
  variant?: string;
}

/** An invoice the tenant already issued, for numbering and credit-note checks. */
export interface IssuedInvoice {
  number: string;
  issueDate: string;
  sellerSiren?: string;
}

export interface RuleContext {
  /** Today in Europe/Paris, "YYYY-MM-DD". */
  today: string;
  /** Invoices already issued. Undefined means unknown: the history rules stay silent. */
  history?: readonly IssuedInvoice[];
  seller: { vatOnDebits: boolean };
  buyer: {
    /** Customer setting: refuses invoices without its purchase-order number (FF-PO-01). */
    requiresPurchaseOrder: boolean;
    /** Customer setting: goods go to another address than the billing one (BR-FR-14). */
    deliversElsewhere: boolean;
    /** Public entity (B2G): DGFiP G2.32 does not apply. */
    publicEntity: boolean;
    /** VIES' last answer on the customer's VAT number (FF-VIES-01); absent: never asked. */
    vat?: ViesVerdict | undefined;
  };
  /** What a building firm knows of this invoice (rules BTP-*); absent: not a building firm. */
  btp?: BtpContext | undefined;
}

/**
 * The BTP rules' facts, each absent when unknown (its rules stay silent). XML carries none of them:
 * they come from the company's records, its sheet, its ERP or the PDF (docs/research/BTP_RULES.md).
 */
export interface BtpContext {
  /**
   * The seller is the buyer's sous-traitant for construction works: the company marked the other party
   * so (a customer it works for as sous-traitant, a supplier that works for it as one). False: marked
   * as neither.
   */
  subcontracting?: boolean | undefined;
  /** The retenue de garantie this invoice is under: a rate in basis points (500 = 5 %), an amount. */
  retenue?: { rateBps?: number | undefined; amount?: number | undefined } | undefined;
  /**
   * The chantier's contract, when the invoice is linked to one and its retenue is known: the rate in
   * basis points, 0 when the contract agreed none.
   */
  chantier?: { retenueBps: number } | undefined;
  /** A situation: its number and cumulative works (cents, HT), and the chantier's previous one. */
  situation?:
    | {
        number: number;
        cumulative?: number | undefined;
        previous?: { number: number; cumulative?: number | undefined } | undefined;
      }
    | undefined;
}

/** What VIES last said of a VAT number (the API asks and keeps the proof, core only reads it). */
export interface ViesVerdict {
  /** As core viesNumber writes it: country code and number, nothing between. */
  vatId: string;
  valid: boolean;
}

export interface Rule {
  id: string;
  severity: Severity;
  scope: Scope;
  source: Source;
  /** Business terms involved, for docs/RULES.md and the add-in. */
  bt: readonly string[];
  /** True only for pure formatting fixes that cannot change the meaning. */
  autoFixable: boolean;
  /** 'import' rules run while reading an XML file (values the model cannot hold). Default 'model'. */
  stage?: 'model' | 'import';
  /** One English sentence for docs/RULES.md. */
  summary: string;
  /** Message key prefix when several official ids share one wording. Defaults to the id. */
  messageKey?: string;
  variants?: readonly string[];
  check(invoice: Invoice, ctx: RuleContext): Finding[];
}

export interface Issue {
  ruleId: string;
  severity: Severity;
  scope: Scope;
  path: string;
  bt: readonly string[];
  params?: Params;
  autoFixable: boolean;
  messageFr: string;
  fixHintFr: string;
}
