import type { AllowanceCharge, Invoice, Line, Party } from '../model';
import type { Finding, Params, Rule } from './types';

/** Identity helper so each rule literal is checked against `Rule`. */
export const rule = (r: Rule): Rule => r;

export const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

export const missing = (value: string | undefined) => !present(value);

export const finding = (path: string, params?: Params, variant?: string): Finding => ({
  path,
  ...(params && { params }),
  ...(variant && { variant }),
});

/** One finding when the condition holds. */
export const when = (condition: boolean, path: string, params?: Params): Finding[] =>
  condition ? [finding(path, params)] : [];

/** Runs `check` on every item and keeps the paths of the failing ones. */
export function each<T>(
  items: readonly T[],
  base: string,
  check: (item: T, index: number) => boolean | Params,
): Finding[] {
  const out: Finding[] = [];
  items.forEach((item, i) => {
    const result = check(item, i);
    if (result === false) return;
    out.push(finding(`${base}[${i}]`, result === true ? undefined : result));
  });
  return out;
}

export interface Party_ {
  key: 'seller' | 'buyer';
  party: Party;
}
export const parties = (inv: Invoice): Party_[] => [
  { key: 'seller', party: inv.seller },
  { key: 'buyer', party: inv.buyer },
];

export interface DocAllowanceCharge {
  item: AllowanceCharge;
  path: string;
  kind: 'allowance' | 'charge';
}
export const docAllowanceCharges = (inv: Invoice): DocAllowanceCharge[] => [
  ...inv.allowances.map((item, i) => ({
    item,
    path: `allowances[${i}]`,
    kind: 'allowance' as const,
  })),
  ...inv.charges.map((item, i) => ({ item, path: `charges[${i}]`, kind: 'charge' as const })),
];

export interface LineAllowanceCharge extends DocAllowanceCharge {
  line: Line;
}
export const lineAllowanceCharges = (inv: Invoice): LineAllowanceCharge[] =>
  inv.lines.flatMap((line, l) => [
    ...line.allowances.map((item, i) => ({
      line,
      item,
      path: `lines[${l}].allowances[${i}]`,
      kind: 'allowance' as const,
    })),
    ...line.charges.map((item, i) => ({
      line,
      item,
      path: `lines[${l}].charges[${i}]`,
      kind: 'charge' as const,
    })),
  ]);

/** Every date of the invoice with its path and field label key. */
export function dates(inv: Invoice): { path: string; field: string; value: string }[] {
  const out: { path: string; field: string; value: string }[] = [];
  const add = (path: string, field: string, value: string | undefined) => {
    if (present(value)) out.push({ path, field, value });
  };
  add('issueDate', 'issueDate', inv.issueDate);
  add('taxPointDate', 'taxPointDate', inv.taxPointDate);
  add('dueDate', 'dueDate', inv.dueDate);
  add('delivery.date', 'deliveryDate', inv.delivery?.date);
  add('invoicePeriod.start', 'periodStart', inv.invoicePeriod?.start);
  add('invoicePeriod.end', 'periodEnd', inv.invoicePeriod?.end);
  inv.precedingInvoices.forEach((p, i) => {
    add(`precedingInvoices[${i}].issueDate`, 'precedingIssueDate', p.issueDate);
  });
  inv.lines.forEach((l, i) => {
    add(`lines[${i}].period.start`, 'linePeriodStart', l.period?.start);
    add(`lines[${i}].period.end`, 'linePeriodEnd', l.period?.end);
  });
  return out;
}

/** Credit notes in the French list (BR-FR-CO-05). */
export const CREDIT_NOTE_TYPES = ['381', '261', '396', '502', '503'];
/** Corrective invoices (BR-FR-CO-04). */
export const CORRECTIVE_TYPES = ['384', '471', '472', '473'];
/** Down-payment invoices (BR-FR-CO-07, BR-FR-CO-08). */
export const DOWN_PAYMENT_TYPES = ['386', '500', '503'];

export const isCreditNote = (inv: Invoice) => CREDIT_NOTE_TYPES.includes(inv.typeCode ?? '');

/** The second character of BT-23 (B1, S2…): 2 = already paid, 4 = final after down payments. */
export const frame = (inv: Invoice) => inv.processType?.trim().toUpperCase().slice(1) ?? '';
/** The first character of BT-23: B goods, S services, M both. */
export const category = (inv: Invoice) => inv.processType?.trim().toUpperCase().charAt(0) ?? '';

/**
 * A buyer established in France, which makes the invoice an e-invoice between French businesses
 * (note BAR = B2B in the CIUS). A missing country counts as France; BR-11 reports it.
 */
export const isDomesticB2B = (inv: Invoice) => (inv.buyer.address?.country ?? 'FR') === 'FR';

export const SIREN_SCHEME = '0002';
export const SIRET_SCHEME = '0009';
export const FR_ADDRESS_SCHEME = '0225';
