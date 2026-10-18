// InboundAgent (plan §6): reads a supplier invoice the platform received and says what to look at
// before paying it (`triage_json`). Deterministic, no model: whether money goes out is not a model's
// call, and every check here is a fact (the file, the numbers, the invoices received before).
import {
  type Cents,
  frDate,
  INBOUND_FLAGS,
  type InboundFlag,
  type InboundState,
  type InboundTriage,
  type Invoice,
  InvoiceXmlError,
  type Issue,
  invoiceIbans,
  isCreditNote,
  isValidIban,
  maskIban,
  parisToday,
  parseInvoiceXml,
  partySiren,
  supplierKey,
  validate,
} from '@fi/core';

/** The columns stored next to the file (inbound_queue), for the triage of later invoices and the export. */
export interface InboundFacts {
  supplierKey: string | null;
  supplierName: string | null;
  number: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amount: Cents | null;
  currency: string | null;
  ibans: string[];
}

export type InboundRead =
  | { ok: true; invoice: Invoice; issues: Issue[]; facts: InboundFacts }
  | { ok: false; reason: string };

/**
 * EN 16931 rules on the totals and the VAT breakdown: when one fails, the amount to pay is not the sum
 * of what was bought. Presence (BR-12…15, 45, 46), sums (BR-CO-10…18), VAT per category (BR-x-08, 09).
 */
const AMOUNT_RULES = /^BR-(?:1[2-5]|4[56]|CO-1[0-8]|(?:S|Z|E|AE|IC|G|O)-0[89])$/;
/** How many rule messages a flag carries: the screen shows them, the file has the rest. */
const DETAILS = 3;

export function readInbound(xml: string, today: string): InboundRead {
  let parsed: ReturnType<typeof parseInvoiceXml>;
  try {
    parsed = parseInvoiceXml(xml);
  } catch (e) {
    if (e instanceof InvoiceXmlError) return { ok: false, reason: e.message };
    throw e;
  }
  const { invoice } = parsed;
  const issues = [...parsed.issues, ...validate(invoice, { today })];
  return {
    ok: true,
    invoice,
    issues,
    facts: {
      supplierKey: supplierKey(invoice.seller) ?? null,
      supplierName: invoice.seller.name?.trim() || null,
      number: invoice.number?.trim() || null,
      issueDate: invoice.issueDate ?? null,
      dueDate: invoice.dueDate ?? null,
      amount: invoice.totals.taxInclusive ?? null,
      currency: invoice.currency ?? null,
      ibans: invoiceIbans(invoice),
    },
  };
}

/** A supplier invoice received before this one (same company, same Mode test side). */
export interface EarlierInbound {
  id: string;
  supplierKey: string | null;
  number: string | null;
  issueDate: string | null;
  amount: Cents | null;
  ibans: string[];
  status: InboundState;
  receivedAt: Date;
}

export interface TriageContext {
  /** The company's SIREN: an invoice for another buyer is not ours to pay. */
  buyerSiren: string;
  /** Earlier invoices of the same supplier, any order. */
  earlier: readonly EarlierInbound[];
}

const ORDER = ['block', 'alert', 'warn', 'info'] as const;
const sameNumber = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.toUpperCase() === b.toUpperCase();
const receivedOn = (row: EarlierInbound) => frDate(parisToday(row.receivedAt));
const details = (issues: readonly Issue[]) =>
  [...new Set(issues.map((i) => i.messageFr))].slice(0, DETAILS);

export function triageInbound(read: InboundRead, context: TriageContext): InboundTriage {
  if (!read.ok) return { flags: [{ code: 'unreadable' }] };
  const { invoice, issues, facts } = read;
  const flags: InboundFlag[] = [];

  const buyer = partySiren(invoice.buyer);
  if (buyer && buyer !== context.buyerSiren)
    flags.push({ code: 'other_buyer', params: { siren: buyer } });

  const errors = issues.filter((i) => i.severity === 'error');
  const amountErrors = errors.filter((i) => AMOUNT_RULES.test(i.ruleId));
  // The export books the VAT breakdown against the total: it has to add up to the cent.
  const booked = invoice.vatBreakdown.reduce(
    (n, v) => n + (v.taxableAmount ?? 0) + (v.taxAmount ?? 0),
    0,
  );
  if (amountErrors.length > 0 || booked !== (invoice.totals.taxInclusive ?? 0)) {
    flags.push({ code: 'amounts', details: details(amountErrors) });
  }
  const otherErrors = errors.filter((i) => !AMOUNT_RULES.test(i.ruleId));
  if (otherErrors.length > 0) {
    flags.push({
      code: 'rules',
      params: { count: otherErrors.length },
      details: details(otherErrors),
    });
  }

  // Disputed invoices do not count: a corrected copy under the same number is what was asked for.
  const known = context.earlier
    .filter((e) => e.supplierKey !== null && e.supplierKey === facts.supplierKey)
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  const standing = known.filter((e) => e.status !== 'disputed');
  const copy = standing.find((e) => sameNumber(e.number, facts.number));
  if (copy) {
    flags.push({
      code: 'duplicate',
      params: { number: copy.number ?? '', date: receivedOn(copy) },
      relatedId: copy.id,
    });
  } else {
    const twin = standing.find(
      (e) => e.amount === facts.amount && e.issueDate !== null && e.issueDate === facts.issueDate,
    );
    if (twin) {
      flags.push({
        code: 'possible_duplicate',
        params: { number: twin.number ?? '', date: receivedOn(twin) },
        relatedId: twin.id,
      });
    }
  }

  const invalid = facts.ibans.find((iban) => !isValidIban(iban));
  if (invalid) flags.push({ code: 'iban_invalid', params: { iban: maskIban(invalid) } });
  const seen = new Set(standing.flatMap((e) => e.ibans));
  const before = standing.find((e) => e.ibans.length > 0)?.ibans[0];
  const after = facts.ibans[0];
  if (before && after && facts.ibans.every((iban) => !seen.has(iban))) {
    flags.push({
      code: 'iban_changed',
      params: { before: maskIban(before), after: maskIban(after) },
    });
  }

  if (facts.supplierKey && known.length === 0) flags.push({ code: 'new_supplier' });
  if (isCreditNote(invoice)) flags.push({ code: 'credit_note' });
  if (facts.currency && facts.currency !== 'EUR') {
    flags.push({ code: 'foreign_currency', params: { currency: facts.currency } });
  }
  const rank = (f: InboundFlag) => ORDER.indexOf(INBOUND_FLAGS[f.code]);
  return { flags: flags.sort((a, b) => rank(a) - rank(b)) };
}
