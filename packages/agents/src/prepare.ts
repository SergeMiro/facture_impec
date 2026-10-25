// Prepare (memory doc §8, docs/plans/memory.md M6): an invoice made whole by code from what the
// memory knows, an accepted quote's lines or a chantier's next situation. The amounts, the VAT, the
// retenue de garantie and autoliquidation are worked out by the sheet's own code (@fi/core), never by
// a model, and the core validator runs before anything is shown: what does not pass is not prepared.
// No amount is ever changed: a quote whose lines, HT or TTC the invoice would not repeat to the cent
// is refused, with its reason. The covering mail is a template. Nothing here sends: the API creates
// the invoice held for « Envoyer » and writes its page.
import {
  type Address,
  type BtpFacts,
  type ContextInput,
  computeInvoice,
  dueDateOf,
  frDate,
  frMoney,
  hasErrors,
  type Invoice,
  InvoiceDefaults,
  type InvoiceDraft,
  type Issue,
  type Line,
  legalNotes,
  lineNetAmount,
  type Party,
  PROCESS_TYPE,
  paymentOf,
  paymentTermsOf,
  percentOf,
  type SellerProfile,
  sellerParty,
  validate,
  withBtp,
} from '@fi/core';
import type { Frontmatter, PageFacts, PageWrite } from '@fi/memory';
import { pagePath } from '@fi/memory';
import { t } from '@fi/shared';

/** A page's facts, as the vault reads them or as a patch writes them. */
type FactsOf<T extends Frontmatter['type']> = Extract<PageFacts, { type: T }>;
type PageLine = NonNullable<FactsOf<'devis'>['lines']>[number];
type DraftLine = Omit<Line, 'netAmount'>;

/** The rates of a French invoice, the ones a quote's TTC is read against. */
const RATES = ['20', '10', '5.5', '2.1'] as const;

/** The company that invoices. */
export interface PrepareCompany {
  seller: SellerProfile;
  /** A building firm: the BTP rules apply and the chantier's retenue is held. */
  btp: boolean;
  vatOnDebits: boolean;
}

/** The customer as its page and its fiche know it. */
export interface PrepareBuyer {
  path: string;
  name: string;
  siren?: string | undefined;
  siret?: string | undefined;
  vatId?: string | undefined;
  email?: string | undefined;
  address?: Address | undefined;
  /** The company works for it as its sous-traitant: autoliquidation (CGI art. 283, 2 nonies). */
  subcontracting: boolean;
  /** Its fiche's settings the rules read. */
  settings?: ContextInput['buyer'];
}

export interface PrepareSite {
  path: string;
  title: string;
  /** BT-11: the ERP's reference, or the code the company gives it. */
  erpRef?: string | undefined;
  /** The retenue de garantie its contract agreed, in basis points. */
  retenueBps?: number | undefined;
}

interface Common {
  company: PrepareCompany;
  buyer: PrepareBuyer;
  /** The invoice's number, the next of the company's series. */
  number: string;
  issueDate: string;
  /** The numbers the company issued, for the history rules. */
  history?: ContextInput['history'];
}

export interface FromQuote extends Common {
  quote: { path: string; facts: FactsOf<'devis'> };
  site?: PrepareSite | undefined;
}

export interface NextSituation extends Common {
  previous: { path: string; facts: FactsOf<'situation'> };
  site: PrepareSite;
  /** The cumulative works HT to date, in cents: the ERP's progress. */
  cumulative: number;
}

export const PREPARE_REFUSALS = [
  'not_accepted',
  'extracted',
  'no_lines',
  'line_amount',
  'total',
  'vat_unknown',
  'autoliquidation_vat',
  'amounts',
  'not_ahead',
  'invalid',
] as const;
export type PrepareRefusal = (typeof PREPARE_REFUSALS)[number];

export interface Prepared {
  ok: true;
  draft: InvoiceDraft;
  invoice: Invoice;
  /** What the validator said, warnings only. */
  issues: Issue[];
  /** Its page in the vault; its source is the invoice's number until the API names its record. */
  page: PageWrite;
  /** The covering mail, from a template. */
  text: string;
}

export interface Refused {
  ok: false;
  reason: PrepareRefusal;
  params: Record<string, string | number>;
  issues?: Issue[];
}

export type Preparation = Prepared | Refused;

const refuse = (
  reason: PrepareRefusal,
  params: Record<string, string | number> = {},
  issues?: Issue[],
): Refused => ({ ok: false, reason, params, ...(issues && { issues }) });

const euros = (cents: number) => (cents / 100).toFixed(2);
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** The one rate whose VAT on `ht` makes `ttc`; none when no rate or two do. */
function rateOf(ht: number, ttc: number | undefined): string | undefined {
  if (ttc === undefined) return undefined;
  const found = RATES.filter((r) => percentOf(ht, r) === ttc - ht);
  return found.length === 1 ? found[0] : undefined;
}

function buyerParty(b: PrepareBuyer): Party {
  return {
    name: b.name,
    ids: b.siret ? [{ id: b.siret, scheme: '0009' }] : [],
    ...(b.siren && {
      legalId: { id: b.siren, scheme: '0002' },
      electronicAddress: { id: b.siren, scheme: '0225' },
    }),
    ...(b.vatId && { vatId: b.vatId }),
    ...(b.address && { address: b.address }),
    ...(b.email && { contact: { email: b.email } }),
  };
}

const vatOf = (subcontracting: boolean, rate: string) =>
  subcontracting ? { category: 'AE', rate: '0' } : { category: 'S', rate };

/** What every prepared invoice carries: the seller's profile, the customer, the terms, the notes. */
function draftOf(input: Common, lines: DraftLine[], refs: Partial<InvoiceDraft>): InvoiceDraft {
  const { company, buyer, number, issueDate } = input;
  const defaults = InvoiceDefaults.parse(company.seller.defaults);
  const dueDate = dueDateOf(issueDate, defaults);
  const paymentTerms = paymentTermsOf(defaults);
  return {
    ...(defaults.operationCategory && { processType: PROCESS_TYPE[defaults.operationCategory] }),
    number,
    issueDate,
    typeCode: '380',
    currency: defaults.currency,
    ...(dueDate && { dueDate }),
    ...(paymentTerms && { paymentTerms }),
    ...refs,
    notes: legalNotes(defaults),
    seller: sellerParty(company.seller, defaults),
    buyer: buyerParty(buyer),
    payment: paymentOf(company.seller, defaults),
    ...(buyer.subcontracting && {
      vatExemptions: [
        { category: 'AE', code: 'VATEX-FR-AE', reason: t('prepare.autoliquidation') },
      ],
    }),
    lines: lines.map((l) => {
      const nature = defaults.operationCategory;
      return nature === 'goods' || nature === 'services' ? { ...l, nature } : l;
    }),
  };
}

/** The core rules on the computed invoice, with what the company knows. */
function check(input: Common, draft: InvoiceDraft, btp: ContextInput['btp']) {
  const invoice = computeInvoice(draft);
  const issues = validate(invoice, {
    today: input.issueDate,
    ...(input.history && { history: input.history }),
    seller: { vatOnDebits: input.company.vatOnDebits },
    ...(input.buyer.settings && { buyer: input.buyer.settings }),
    ...(input.company.btp && { btp }),
  });
  return { invoice, issues };
}

function refusedBy(issues: Issue[]): Refused {
  const errors = issues.filter((i) => i.severity === 'error');
  return refuse('invalid', { count: errors.length, first: errors[0]?.messageFr ?? '' }, issues);
}

/** The covering mail: who, what, how much, until when. */
function mail(input: Common, invoice: Invoice, body: string): string {
  const { dueDate } = invoice;
  return [
    t('prepare.text.hello'),
    '',
    body,
    ...(input.buyer.subcontracting ? [t('prepare.text.autoliquidation')] : []),
    // FF-DUE-01 holds no invoice with an amount due and no due date.
    ...(dueDate ? [t('prepare.text.due', { due: frDate(dueDate) })] : []),
    '',
    t('prepare.text.bye'),
    input.company.seller.name,
  ].join('\n');
}

const rateText = (l: DraftLine) => Number(l.vat.rate ?? '0');

/**
 * The invoice of an accepted quote: its lines as they are, its VAT (each line's rate, else the one
 * its HT and TTC give), autoliquidation for a donneur d'ordre, the chantier's retenue, its number as
 * BT-14 (the link rules tie them by it) and the chantier's reference as BT-11.
 */
export function invoiceFromQuote(input: FromQuote): Preparation {
  const q = input.quote.facts;
  const quote = { quote: q.number };
  if (q.status !== 'accepte') return refuse('not_accepted', quote);
  // Numbers a model or OCR read are never prepared on (memory doc §4).
  if (q.extracted) return refuse('extracted', quote);
  const given = q.lines ?? [];
  if (!given.length) return refuse('no_lines', quote);
  const ht = sum(given.map((l) => l.amount));
  if (q.ht !== undefined && ht !== q.ht) {
    return refuse('total', { ...quote, lines: frMoney(ht), ht: frMoney(q.ht) });
  }
  const { subcontracting } = input.buyer;
  if (subcontracting) {
    const taxed = (q.ttc !== undefined && q.ttc !== ht) || given.some((l) => (l.vat_rate ?? 0) > 0);
    if (taxed) {
      return refuse('autoliquidation_vat', { ...quote, tva: frMoney((q.ttc ?? ht) - ht) });
    }
  }
  const whole = given.every((l) => l.vat_rate !== undefined) ? undefined : rateOf(ht, q.ttc);
  const lines: DraftLine[] = [];
  for (const [i, l] of given.entries()) {
    const rate = l.vat_rate !== undefined ? String(l.vat_rate) : whole;
    if (!subcontracting && (rate === undefined || Number(rate) === 0)) {
      return refuse('vat_unknown', quote);
    }
    const priced = l.quantity !== undefined && l.unit_price !== undefined;
    const line: DraftLine = {
      id: String(i + 1),
      quantity: priced ? String(l.quantity) : '1',
      unitCode: 'C62',
      allowances: [],
      charges: [],
      price: { net: euros(priced ? (l.unit_price as number) : l.amount) },
      vat: vatOf(subcontracting, rate ?? '0'),
      item: { name: l.label, ...(l.code && { sellerId: l.code }) },
    };
    if (lineNetAmount(line) !== l.amount) return refuse('line_amount', { ...quote, line: l.label });
    lines.push(line);
  }

  const site = input.site;
  const draft = draftOf(input, lines, {
    salesOrderReference: q.number,
    ...(site?.erpRef && { projectReference: site.erpRef }),
  });
  const retenueBps = input.company.btp ? (site?.retenueBps ?? 0) : 0;
  if (retenueBps > 0) withBtp(draft, { retenue: { rateBps: retenueBps } });
  const { invoice, issues } = check(input, draft, {
    subcontracting,
    ...(draft.btp?.retenue && { retenue: draft.btp.retenue }),
    ...(site?.retenueBps !== undefined && { chantier: { retenueBps: site.retenueBps } }),
  });
  // Every amount is the quote's: the VAT rounded otherwise would change its TTC.
  const { taxExclusive, taxTotal, taxInclusive } = invoice.totals;
  if (taxExclusive !== ht || (q.ttc !== undefined && taxInclusive !== q.ttc)) {
    return refuse('amounts', {
      ...quote,
      invoice: frMoney(taxInclusive ?? 0),
      ttc: frMoney(q.ttc ?? 0),
    });
  }
  if (hasErrors(issues)) return refusedBy(issues);

  const { number, issueDate } = input;
  const facts: FactsOf<'facture_vente'> = {
    type: 'facture_vente',
    title: t('prepare.page.title', { number }),
    sources: [`invoice:${number.replace(/\s+/g, '-')}`],
    number,
    party: input.buyer.path,
    issue_date: issueDate,
    ...(invoice.dueDate && { due_date: invoice.dueDate }),
    ht: taxExclusive,
    tva: taxTotal ?? 0,
    ttc: taxInclusive ?? 0,
    ...(site && { chantier: site.path }),
    sales_order_ref: q.number,
    lines: given.map((l, i): PageLine => ({ ...l, vat_rate: rateText(lines[i] as DraftLine) })),
  };
  return {
    ok: true,
    draft,
    invoice,
    issues,
    page: {
      path: pagePath(facts),
      frontmatter: facts,
      text: t('prepare.page.quote', quote),
    },
    text: mail(
      input,
      invoice,
      t('prepare.text.quote', {
        number,
        date: frDate(issueDate),
        quote: q.number,
        ttc: frMoney(taxInclusive ?? 0, invoice.currency),
      }),
    ),
  };
}

/**
 * The situation after `previous`: the cumulative works HT the ERP gives, less the last situation's;
 * its number follows, its VAT is the last one's, the retenue and the notes are the sheet's.
 */
export function nextSituation(input: NextSituation): Preparation {
  const prev = input.previous.facts;
  if (prev.extracted) return refuse('extracted', { quote: prev.title });
  const number = prev.number + 1;
  const ht = input.cumulative - prev.cumul_ht;
  if (ht <= 0) {
    return refuse('not_ahead', {
      number: prev.number,
      cumulative: frMoney(input.cumulative),
      previous: frMoney(prev.cumul_ht),
    });
  }
  const { subcontracting } = input.buyer;
  const rate = prev.ht === undefined ? undefined : rateOf(prev.ht, prev.ttc);
  if (!subcontracting && rate === undefined) return refuse('vat_unknown', { quote: prev.title });

  const { site } = input;
  const line: DraftLine = {
    id: '1',
    quantity: '1',
    unitCode: 'C62',
    allowances: [],
    charges: [],
    price: { net: euros(ht) },
    vat: vatOf(subcontracting, rate ?? '0'),
    item: {
      name: t('prepare.line.situation', {
        number,
        cumulative: frMoney(input.cumulative),
        previous: frMoney(prev.cumul_ht),
      }),
    },
  };
  const draft = draftOf(input, [line], { projectReference: site.erpRef ?? site.title });
  const retenueBps = input.company.btp ? (site.retenueBps ?? 0) : 0;
  const btp: BtpFacts = {
    ...(retenueBps > 0 && { retenue: { rateBps: retenueBps } }),
    situation: { number, cumulative: input.cumulative },
  };
  withBtp(draft, btp);
  const { invoice, issues } = check(input, draft, {
    subcontracting,
    ...(btp.retenue && { retenue: btp.retenue }),
    ...(site.retenueBps !== undefined && { chantier: { retenueBps: site.retenueBps } }),
    situation: {
      number,
      cumulative: input.cumulative,
      previous: { number: prev.number, cumulative: prev.cumul_ht },
    },
  });
  if (hasErrors(issues)) return refusedBy(issues);

  const { taxInclusive } = invoice.totals;
  const facts: FactsOf<'situation'> = {
    type: 'situation',
    title: t('prepare.page.situation.title', { number, chantier: site.title }),
    sources: [`invoice:${input.number.replace(/\s+/g, '-')}`],
    chantier: site.path,
    number,
    cumul_ht: input.cumulative,
    party: input.buyer.path,
    issue_date: input.issueDate,
    ...(invoice.dueDate && { due_date: invoice.dueDate }),
    ht,
    ttc: taxInclusive ?? 0,
    ...(btp.retenue?.amount !== undefined && { retenue: btp.retenue.amount }),
  };
  const params = {
    number,
    invoice: input.number,
    chantier: site.title,
    ht: frMoney(ht, invoice.currency),
    cumulative: frMoney(input.cumulative, invoice.currency),
    ttc: frMoney(taxInclusive ?? 0, invoice.currency),
    date: frDate(input.issueDate),
  };
  return {
    ok: true,
    draft,
    invoice,
    issues,
    page: {
      path: pagePath(facts),
      frontmatter: facts,
      text: t('prepare.page.situation.text', { ...params, previous: prev.number }),
    },
    text: mail(input, invoice, t('prepare.text.situation', params)),
  };
}
