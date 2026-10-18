// EN 16931 VAT category rules (BR-S, BR-Z, BR-E, BR-AE, BR-IC, BR-G, BR-O), generated per category
// from the CEN statements. L, M and B are not used in France (BR-FR-15), so their families are left out.

import type { AllowanceCharge, Invoice, Party } from '../model';
import { compareDecimal, isDecimal, sum } from '../money';
import { expectedTax, withinOneUnit } from './en16931';
import type { Finding, Rule } from './types';
import { each, finding, missing, present, rule, when } from './util';

type RateRule = 'positive' | 'zero' | 'none';

interface CategorySpec {
  code: string;
  /** The id prefix: K uses IC. */
  prefix: string;
  name: string;
  rate: RateRule;
  exemption: 'forbidden' | 'required';
  /** What BR-x-02/03/04 ask of the parties, as a test and as words for docs/RULES.md. */
  parties: { test: (seller: Party, buyer: Party) => boolean; summary: string };
}

const sellerVatOrFiscal = (s: Party) => present(s.vatId) || present(s.taxRegistrationId);

const SPECS: CategorySpec[] = [
  {
    code: 'S',
    prefix: 'S',
    name: 'standard rated',
    rate: 'positive',
    exemption: 'forbidden',
    parties: {
      test: (s) => sellerVatOrFiscal(s),
      summary: 'the seller VAT identifier or tax registration identifier is present',
    },
  },
  {
    code: 'Z',
    prefix: 'Z',
    name: 'zero rated',
    rate: 'zero',
    exemption: 'forbidden',
    parties: {
      test: (s) => sellerVatOrFiscal(s),
      summary: 'the seller VAT identifier or tax registration identifier is present',
    },
  },
  {
    code: 'E',
    prefix: 'E',
    name: 'exempt from VAT',
    rate: 'zero',
    exemption: 'required',
    parties: {
      test: (s) => sellerVatOrFiscal(s),
      summary: 'the seller VAT identifier or tax registration identifier is present',
    },
  },
  {
    code: 'AE',
    prefix: 'AE',
    name: 'reverse charge',
    rate: 'zero',
    exemption: 'required',
    parties: {
      test: (s, b) => sellerVatOrFiscal(s) && (present(b.vatId) || present(b.legalId?.id)),
      summary:
        'the seller VAT or tax registration identifier, and the buyer VAT or legal registration identifier, are present',
    },
  },
  {
    code: 'K',
    prefix: 'IC',
    name: 'intra-community supply',
    rate: 'zero',
    exemption: 'required',
    parties: {
      test: (s, b) => present(s.vatId) && present(b.vatId),
      summary: 'the seller and buyer VAT identifiers are present',
    },
  },
  {
    code: 'G',
    prefix: 'G',
    name: 'export outside the EU',
    rate: 'zero',
    exemption: 'required',
    parties: {
      test: (s) => present(s.vatId),
      summary: 'the seller VAT identifier is present',
    },
  },
  {
    code: 'O',
    prefix: 'O',
    name: 'not subject to VAT',
    rate: 'none',
    exemption: 'required',
    parties: {
      test: (s, b) => !present(s.vatId) && !present(b.vatId),
      summary: 'neither the seller nor the buyer VAT identifier is present',
    },
  },
];

const rateOk = (rate: string | undefined, rule: RateRule) => {
  if (rule === 'none') return rate === undefined;
  if (rate === undefined || !isDecimal(rate)) return false;
  return rule === 'positive' ? compareDecimal(rate, '0') === 1 : compareDecimal(rate, '0') === 0;
};

const rateWords: Record<RateRule, string> = {
  positive: 'is greater than zero',
  zero: 'is 0',
  none: 'is absent',
};

const sameRate = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && isDecimal(a) && isDecimal(b)
    ? compareDecimal(a, b) === 0
    : a === b;

/** Taxable base of a category (and rate, for S): lines + charges − allowances. */
function taxableBase(inv: Invoice, code: string, rate?: string) {
  const matches = (category: string | undefined, r: string | undefined) =>
    category === code && (rate === undefined || sameRate(r, rate));
  const pick = (items: readonly AllowanceCharge[]) =>
    sum(items.filter((a) => matches(a.vatCategory, a.vatRate)).map((a) => a.amount ?? 0));
  const lines = sum(
    inv.lines.filter((l) => matches(l.vat.category, l.vat.rate)).map((l) => l.netAmount ?? 0),
  );
  return lines + pick(inv.charges) - pick(inv.allowances);
}

const usesCategory = (inv: Invoice, code: string) =>
  inv.lines.some((l) => l.vat.category === code) ||
  inv.allowances.some((a) => a.vatCategory === code) ||
  inv.charges.some((c) => c.vatCategory === code);

function familyRules(spec: CategorySpec): Rule[] {
  const { code, prefix, name } = spec;
  const id = (n: string) => `BR-${prefix}-${n}`;
  const base = { severity: 'error', scope: 'vat', source: 'EN16931', autoFixable: false } as const;
  /** Shared French wording for one family member, with the category as a parameter. */
  const shared = (n: string) => ({ messageKey: `BR-VAT-${n}` });
  /** Reverse charge, intra-EU supply and out of scope ask other things of the parties: own wording. */
  const partiesMessage = ['AE', 'K', 'O'].includes(code)
    ? { messageKey: `BR-${prefix}-02` }
    : shared('02');
  const breakdowns = (inv: Invoice) =>
    inv.vatBreakdown.flatMap((b, i) =>
      b.category === code ? [{ b, path: `vatBreakdown[${i}]` }] : [],
    );
  const params = { category: code };

  const rules: Rule[] = [
    rule({
      ...base,
      ...shared('01'),
      id: id('01'),
      bt: ['BT-118', 'BT-151', 'BT-95', 'BT-102'],
      summary:
        code === 'S'
          ? `An invoice using category ${code} (${name}) has at least one VAT breakdown for it.`
          : `An invoice using category ${code} (${name}) has exactly one VAT breakdown for it.`,
      check: (inv) => {
        if (!usesCategory(inv, code)) return [];
        const count = breakdowns(inv).length;
        return when(code === 'S' ? count === 0 : count !== 1, 'vatBreakdown', params);
      },
    }),
    rule({
      ...base,
      ...partiesMessage,
      id: id('02'),
      bt: ['BT-151', 'BT-31', 'BT-32', 'BT-47', 'BT-48'],
      summary: `A line with category ${code}: ${spec.parties.summary}.`,
      check: (inv) =>
        inv.lines.some((l) => l.vat.category === code) && !spec.parties.test(inv.seller, inv.buyer)
          ? [finding(code === 'O' ? 'seller.vatId' : partyPath(spec, inv), params)]
          : [],
    }),
    rule({
      ...base,
      ...partiesMessage,
      id: id('03'),
      bt: ['BT-95', 'BT-31', 'BT-32', 'BT-47', 'BT-48'],
      summary: `A document level allowance with category ${code}: ${spec.parties.summary}.`,
      check: (inv) =>
        inv.allowances.some((a) => a.vatCategory === code) &&
        !spec.parties.test(inv.seller, inv.buyer)
          ? [finding(code === 'O' ? 'seller.vatId' : partyPath(spec, inv), params)]
          : [],
    }),
    rule({
      ...base,
      ...partiesMessage,
      id: id('04'),
      bt: ['BT-102', 'BT-31', 'BT-32', 'BT-47', 'BT-48'],
      summary: `A document level charge with category ${code}: ${spec.parties.summary}.`,
      check: (inv) =>
        inv.charges.some((c) => c.vatCategory === code) && !spec.parties.test(inv.seller, inv.buyer)
          ? [finding(code === 'O' ? 'seller.vatId' : partyPath(spec, inv), params)]
          : [],
    }),
    rule({
      ...base,
      ...shared(`05-${spec.rate}`),
      id: id('05'),
      bt: ['BT-152'],
      summary: `The VAT rate of a line with category ${code} ${rateWords[spec.rate]}.`,
      check: (inv) =>
        each(
          inv.lines,
          'lines',
          (l) => l.vat.category === code && !rateOk(l.vat.rate, spec.rate) && params,
        ).map((f) => ({ ...f, path: `${f.path}.vat.rate` })),
    }),
    rule({
      ...base,
      ...shared(`05-${spec.rate}`),
      id: id('06'),
      bt: ['BT-96'],
      summary: `The VAT rate of a document level allowance with category ${code} ${rateWords[spec.rate]}.`,
      check: (inv) =>
        each(
          inv.allowances,
          'allowances',
          (a) => a.vatCategory === code && !rateOk(a.vatRate, spec.rate) && params,
        ).map((f) => ({ ...f, path: `${f.path}.vatRate` })),
    }),
    rule({
      ...base,
      ...shared(`05-${spec.rate}`),
      id: id('07'),
      bt: ['BT-103'],
      summary: `The VAT rate of a document level charge with category ${code} ${rateWords[spec.rate]}.`,
      check: (inv) =>
        each(
          inv.charges,
          'charges',
          (c) => c.vatCategory === code && !rateOk(c.vatRate, spec.rate) && params,
        ).map((f) => ({ ...f, path: `${f.path}.vatRate` })),
    }),
    rule({
      ...base,
      ...shared('08'),
      id: id('08'),
      bt: ['BT-116', 'BT-131', 'BT-92', 'BT-99'],
      summary:
        code === 'S'
          ? 'For each standard rate, the taxable amount = lines + charges − allowances at that rate, within one currency unit.'
          : `The taxable amount of category ${code} = lines + charges − allowances of that category.`,
      check: (inv) =>
        breakdowns(inv).flatMap(({ b, path }): Finding[] => {
          if (b.taxableAmount === undefined) return [];
          if (code === 'S') {
            // Checked per rate, as in CEN: without a rate there is nothing to compare (BR-48 says so).
            if (!present(b.rate)) return [];
            const exists =
              inv.lines.some((l) => l.vat.category === 'S' && sameRate(l.vat.rate, b.rate)) ||
              [...inv.allowances, ...inv.charges].some(
                (a) => a.vatCategory === 'S' && sameRate(a.vatRate, b.rate),
              );
            const ok = exists && withinOneUnit(b.taxableAmount, taxableBase(inv, 'S', b.rate));
            return ok ? [] : [finding(`${path}.taxableAmount`, params)];
          }
          return when(b.taxableAmount !== taxableBase(inv, code), `${path}.taxableAmount`, params);
        }),
    }),
    rule({
      ...base,
      ...shared(code === 'S' ? '09-S' : '09'),
      id: id('09'),
      bt: ['BT-117'],
      summary:
        code === 'S'
          ? 'A standard rated VAT breakdown has tax = taxable amount × rate / 100, within one currency unit.'
          : `The tax amount of a category ${code} VAT breakdown is 0.`,
      check: (inv) =>
        breakdowns(inv).flatMap(({ b, path }): Finding[] => {
          if (b.taxAmount === undefined) return [];
          if (code !== 'S') return when(b.taxAmount !== 0, `${path}.taxAmount`, params);
          if (b.taxableAmount === undefined || !present(b.rate)) return [];
          const expected = expectedTax(b.taxableAmount, b.rate);
          return when(
            expected !== null && !withinOneUnit(Math.abs(b.taxAmount), expected),
            `${path}.taxAmount`,
            params,
          );
        }),
    }),
    rule({
      ...base,
      ...shared(`10-${spec.exemption}`),
      id: id('10'),
      bt: ['BT-120', 'BT-121'],
      summary:
        spec.exemption === 'forbidden'
          ? `A category ${code} VAT breakdown has no exemption reason or reason code.`
          : `A category ${code} VAT breakdown has an exemption reason or reason code.`,
      check: (inv) =>
        breakdowns(inv).flatMap(({ b, path }) => {
          const hasReason = present(b.exemptionReason) || present(b.exemptionCode);
          const bad = spec.exemption === 'forbidden' ? hasReason : !hasReason;
          return when(bad, `${path}.exemptionCode`, params);
        }),
    }),
  ];
  return rules;
}

/** Where to point the user when BR-x-02 fails: the missing party field. */
function partyPath(spec: CategorySpec, inv: Invoice) {
  if (!sellerVatOrFiscal(inv.seller) || (spec.code !== 'AE' && missing(inv.seller.vatId)))
    return 'seller.vatId';
  return 'buyer.vatId';
}

const hasBreakdown = (inv: Invoice, code: string) =>
  inv.vatBreakdown.some((b) => b.category === code);

const vatBase = { severity: 'error', scope: 'vat', source: 'EN16931', autoFixable: false } as const;

const EXTRA_RULES: Rule[] = [
  rule({
    ...vatBase,
    id: 'BR-IC-11',
    scope: 'delivery',
    bt: ['BT-72', 'BG-14'],
    summary: 'An intra-community supply (K) has an actual delivery date or an invoicing period.',
    check: (inv) =>
      when(
        hasBreakdown(inv, 'K') &&
          missing(inv.delivery?.date) &&
          missing(inv.invoicePeriod?.start) &&
          missing(inv.invoicePeriod?.end),
        'delivery.date',
      ),
  }),
  rule({
    ...vatBase,
    id: 'BR-IC-12',
    scope: 'delivery',
    bt: ['BT-80'],
    summary: 'An intra-community supply (K) has a deliver-to country code.',
    check: (inv) =>
      when(
        hasBreakdown(inv, 'K') && missing(inv.delivery?.address?.country),
        'delivery.address.country',
      ),
  }),
  rule({
    ...vatBase,
    id: 'BR-O-11',
    messageKey: 'BR-O-1x',
    bt: ['BT-118'],
    summary: 'An invoice with a category O VAT breakdown has no VAT breakdown of another category.',
    check: (inv) =>
      hasBreakdown(inv, 'O')
        ? each(inv.vatBreakdown, 'vatBreakdown', (b) => b.category !== 'O').map((f) => ({
            ...f,
            path: `${f.path}.category`,
          }))
        : [],
  }),
  rule({
    ...vatBase,
    id: 'BR-O-12',
    messageKey: 'BR-O-1x',
    bt: ['BT-151'],
    summary: 'An invoice with a category O VAT breakdown has no line of another category.',
    check: (inv) =>
      hasBreakdown(inv, 'O')
        ? each(inv.lines, 'lines', (l) => present(l.vat.category) && l.vat.category !== 'O').map(
            (f) => ({ ...f, path: `${f.path}.vat.category` }),
          )
        : [],
  }),
  rule({
    ...vatBase,
    id: 'BR-O-13',
    messageKey: 'BR-O-1x',
    bt: ['BT-95'],
    summary:
      'An invoice with a category O VAT breakdown has no document level allowance of another category.',
    check: (inv) =>
      hasBreakdown(inv, 'O')
        ? each(
            inv.allowances,
            'allowances',
            (a) => present(a.vatCategory) && a.vatCategory !== 'O',
          ).map((f) => ({ ...f, path: `${f.path}.vatCategory` }))
        : [],
  }),
  rule({
    ...vatBase,
    id: 'BR-O-14',
    messageKey: 'BR-O-1x',
    bt: ['BT-102'],
    summary:
      'An invoice with a category O VAT breakdown has no document level charge of another category.',
    check: (inv) =>
      hasBreakdown(inv, 'O')
        ? each(inv.charges, 'charges', (c) => present(c.vatCategory) && c.vatCategory !== 'O').map(
            (f) => ({ ...f, path: `${f.path}.vatCategory` }),
          )
        : [],
  }),
];

export const VAT_CATEGORIES = SPECS.map((s) => s.code);
export const VAT_RULES: Rule[] = [...SPECS.flatMap(familyRules), ...EXTRA_RULES];
