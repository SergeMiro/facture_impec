// Draft → invoice: line net amounts, document totals (BG-22) and the VAT breakdown (BG-23).
// The computation is mechanical: a missing or malformed quantity, price or rate counts as zero and the
// matching rule (BR-22, BR-26, FF-FMT-04…) tells the user what to fix. It never guesses. An allowance
// or charge given only as a percentage gets its amount from its base, as the norm defines it
// (BT-92 = BT-93 × BT-94 / 100): the base given, else the line's gross amount, else the net amount
// of the lines in its VAT category and rate.

import {
  type AllowanceCharge,
  EN16931_SPECIFICATION,
  Invoice,
  InvoiceDraft,
  type Line,
  type Totals,
  type VatBreakdown,
} from './model';
import { lineAmount, normalizeDecimal, percentOf, sum } from './money';

type ParsedDraft = ReturnType<typeof InvoiceDraft.parse>;
type DraftLine = ParsedDraft['lines'][number];

const amounts = (items: readonly AllowanceCharge[]) => sum(items.map((a) => a.amount ?? 0));

/** Quantity × net price / base quantity: the line before its allowances and charges. */
function lineGross({ quantity, price }: Pick<Line, 'quantity' | 'price'>): number {
  return quantity !== undefined && price.net !== undefined
    ? (lineAmount(quantity, price.net, price.baseQuantity ?? '1') ?? 0)
    : 0;
}

/** BT-131 = quantity × net price / base quantity − line allowances + line charges. */
export function lineNetAmount(line: Omit<Line, 'netAmount'>): number {
  return lineGross(line) - amounts(line.allowances) + amounts(line.charges);
}

/**
 * A percentage without an amount gets its amount, rounded to the cent, from its base: the one given,
 * else `base()`. A typed amount stays as typed; a malformed percentage stays without an amount, and
 * BR-41 / BR-31 / FF-FMT-04 say so.
 */
export function withAmount(item: AllowanceCharge, base: () => number): AllowanceCharge {
  if (item.amount !== undefined || item.percentage === undefined) return item;
  const baseAmount = item.baseAmount ?? base();
  const amount = percentOf(baseAmount, item.percentage);
  return amount === null ? item : { ...item, baseAmount, amount };
}

/** The net amount of the lines a document allowance or charge applies to: its VAT category and rate. */
function documentBase(lines: readonly Line[], item: AllowanceCharge): number {
  const same = (l: Line) =>
    item.vatCategory === undefined ||
    (l.vat.category === item.vatCategory &&
      (item.vatCategory === 'O' || rateKey(l.vat.rate) === rateKey(item.vatRate)));
  return sum(lines.filter(same).map((l) => l.netAmount ?? 0));
}

const rateKey = (rate: string | undefined) =>
  rate !== undefined ? (normalizeDecimal(rate) ?? rate) : undefined;

interface Group {
  category: string;
  rate: string | undefined;
  taxable: number;
}

/**
 * One BG-23 per VAT category and rate, in order of first appearance (lines, then document charges and
 * allowances). Category O has no rate. Items without a category are left out: BR-CO-04 / BR-32 / BR-37
 * report them.
 */
export function vatBreakdown(
  lines: readonly Line[],
  allowances: readonly AllowanceCharge[],
  charges: readonly AllowanceCharge[],
  exemptions: ParsedDraft['vatExemptions'] = [],
): VatBreakdown[] {
  const groups = new Map<string, Group>();
  const add = (category: string | undefined, rate: string | undefined, amount: number) => {
    if (!category) return;
    const r = category === 'O' ? undefined : rateKey(rate);
    const key = `${category}|${r ?? ''}`;
    const group = groups.get(key) ?? { category, rate: r, taxable: 0 };
    group.taxable += amount;
    groups.set(key, group);
  };
  for (const line of lines) add(line.vat.category, line.vat.rate, line.netAmount ?? 0);
  for (const c of charges) add(c.vatCategory, c.vatRate, c.amount ?? 0);
  for (const a of allowances) add(a.vatCategory, a.vatRate, -(a.amount ?? 0));

  return [...groups.values()].map(({ category, rate, taxable }) => {
    const exemption = exemptions.find((e) => e.category === category);
    const taxAmount = rate !== undefined ? (percentOf(taxable, rate) ?? 0) : 0;
    return {
      category,
      ...(rate !== undefined && { rate }),
      taxableAmount: taxable,
      taxAmount,
      ...(exemption?.reason !== undefined && { exemptionReason: exemption.reason }),
      ...(exemption?.code !== undefined && { exemptionCode: exemption.code }),
    };
  });
}

export function documentTotals(
  lines: readonly Line[],
  allowances: readonly AllowanceCharge[],
  charges: readonly AllowanceCharge[],
  breakdown: readonly VatBreakdown[],
  prepaid?: number,
  taxTotalAccountingCurrency?: number,
): Totals {
  const lineTotal = sum(lines.map((l) => l.netAmount ?? 0));
  const allowanceTotal = amounts(allowances);
  const chargeTotal = amounts(charges);
  const taxExclusive = lineTotal - allowanceTotal + chargeTotal;
  const taxTotal = sum(breakdown.map((b) => b.taxAmount ?? 0));
  const taxInclusive = taxExclusive + taxTotal;
  return {
    lineTotal,
    ...(allowances.length > 0 && { allowanceTotal }),
    ...(charges.length > 0 && { chargeTotal }),
    taxExclusive,
    taxTotal,
    ...(taxTotalAccountingCurrency !== undefined && { taxTotalAccountingCurrency }),
    taxInclusive,
    ...(prepaid !== undefined && { prepaid }),
    payable: taxInclusive - (prepaid ?? 0),
  };
}

/** Parse a draft (Zod, boundary) and compute everything a draft leaves out. */
export function computeInvoice(input: InvoiceDraft): Invoice {
  const {
    vatExemptions,
    prepaid,
    taxTotalAccountingCurrency,
    lines,
    allowances: draftAllowances,
    charges: draftCharges,
    ...rest
  } = InvoiceDraft.parse(input);
  const computedLines = lines.map((line: DraftLine) => {
    const gross = () => lineGross(line);
    const resolved = {
      ...line,
      allowances: line.allowances.map((a) => withAmount(a, gross)),
      charges: line.charges.map((c) => withAmount(c, gross)),
    };
    return { ...resolved, netAmount: lineNetAmount(resolved) };
  });
  const allowances = draftAllowances.map((a) =>
    withAmount(a, () => documentBase(computedLines, a)),
  );
  const charges = draftCharges.map((c) => withAmount(c, () => documentBase(computedLines, c)));
  const breakdown = vatBreakdown(computedLines, allowances, charges, vatExemptions);
  return Invoice.parse({
    ...rest,
    specificationId: EN16931_SPECIFICATION,
    lines: computedLines,
    allowances,
    charges,
    vatBreakdown: breakdown,
    totals: documentTotals(
      computedLines,
      allowances,
      charges,
      breakdown,
      prepaid,
      taxTotalAccountingCurrency,
    ),
  });
}
