// What each sold line cost (R3): the purchase of the same article — a supplier invoice received through
// the platform, a row of the « Achats » sheet — that gives an invoice line its cost for rule B2. The
// same article is the company's own reference on both sides (the registry gives both lines the same
// item), else the same name; another unit or currency is another article. The latest purchase on or
// before the sale counts, else the first one in the days after it. Each purchase used is a link of kind
// « cost » to the invoice; a person's « Non » on one makes the next purchase count.
import { addDays } from '../dates';
import { unitNet } from './amounts';
import { isInvoice, linkId } from './link';
import type { CheckDoc, CheckLine, Link, LinkDecision, LinkStatus } from './types';

/** A purchase after the sale still gives its cost within these days: the supplier's invoice often comes later. */
export const COST_AFTER_DAYS = 60;

/** Lowercase, no accents, no punctuation, single spaces: « Journée  de conseil. » → journee de conseil. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A supplier invoice (not its credit note or advance), or a row of a purchase sheet. */
export const isPurchase = (d: CheckDoc) =>
  d.direction === 'in' &&
  (d.kind === 'purchase' || (d.kind === 'invoice' && d.typeCode !== '381' && d.typeCode !== '386'));

export interface Cost {
  doc: CheckDoc;
  line: CheckLine;
  /** Cents with fractions, the purchase's discount taken off. */
  unit: number;
  /** The same item (the company's own reference), or only the same name. */
  by: 'item' | 'name';
}

/** « One », « piece », « each » (UN/ECE rec. 20): a sheet's invoice says C62 where a supplier says H87. */
const ONE = new Set(['C62', 'H87', 'EA']);
export const unitOf = (code: string | null | undefined) => (code && ONE.has(code) ? 'C62' : code);

interface Bought {
  doc: CheckDoc;
  line: CheckLine;
  unit: number;
  /** '' when the purchase has no date: older than any dated one. */
  date: string;
}

const byDate = (a: Bought, b: Bought) =>
  a.date.localeCompare(b.date) ||
  (a.doc.id < b.doc.id ? -1 : a.doc.id > b.doc.id ? 1 : a.line.position - b.line.position);

function index(purchases: readonly CheckDoc[]) {
  const byItem = new Map<string, Bought[]>();
  const byName = new Map<string, Bought[]>();
  const add = (map: Map<string, Bought[]>, key: string, b: Bought) =>
    map.set(key, [...(map.get(key) ?? []), b]);
  for (const doc of purchases) {
    for (const line of doc.lines) {
      const unit = unitNet(doc, line);
      if (unit === null || unit <= 0) continue;
      const b = { doc, line, unit, date: doc.issueDate ?? '' };
      if (line.itemId) add(byItem, line.itemId, b);
      const name = line.name ? normalizeName(line.name) : '';
      if (name) add(byName, name, b);
    }
  }
  for (const list of [...byItem.values(), ...byName.values()]) list.sort(byDate);
  return { byItem, byName };
}

/** The purchase that gives a sold line its cost, or null. */
function costFor(
  sale: CheckDoc,
  line: CheckLine,
  bought: ReturnType<typeof index>,
  decision: (purchase: CheckDoc) => LinkStatus | undefined,
): Cost | null {
  const sameTerms = (b: Bought) =>
    (b.doc.currency ?? 'EUR') === (sale.currency ?? 'EUR') &&
    (!b.line.unitCode || !line.unitCode || unitOf(b.line.unitCode) === unitOf(line.unitCode)) &&
    decision(b.doc) !== 'rejected';
  let by: Cost['by'] = 'item';
  let found = (line.itemId ? (bought.byItem.get(line.itemId) ?? []) : []).filter(sameTerms);
  if (found.length === 0 && line.name) {
    by = 'name';
    found = (bought.byName.get(normalizeName(line.name)) ?? []).filter(sameTerms);
  }
  // A purchase a person confirmed for this invoice comes first.
  const confirmed = found.filter((b) => decision(b.doc) === 'confirmed');
  if (confirmed.length > 0) found = confirmed;
  const day = sale.issueDate;
  const before = day ? found.filter((b) => b.date <= day) : found;
  const pick =
    before.at(-1) ?? (day ? found.find((b) => b.date <= addDays(day, COST_AFTER_DAYS)) : undefined);
  return pick ? { doc: pick.doc, line: pick.line, unit: pick.unit, by } : null;
}

/**
 * The cost of every sold line that has one, by `invoiceId:position`, and the « cost » links of the
 * purchases used. A credit note or an advance invoice sells nothing.
 */
export function findCosts(
  docs: readonly CheckDoc[],
  decisions: readonly LinkDecision[],
): { costs: Map<string, Cost>; links: Link[] } {
  const costs = new Map<string, Cost>();
  const links = new Map<string, Link>();
  const purchases = docs.filter(isPurchase);
  if (purchases.length === 0) return { costs, links: [] };
  const bought = index(purchases);
  const decided = new Map(
    decisions.filter((d) => d.kind === 'cost').map((d) => [linkId(d), d.status]),
  );
  for (const sale of docs.filter(isInvoice)) {
    if (sale.typeCode === '381' || sale.typeCode === '386') continue;
    const pair = (purchase: CheckDoc) =>
      linkId({ kind: 'cost', fromDocId: purchase.id, toDocId: sale.id });
    const decision = (purchase: CheckDoc) => decided.get(pair(purchase));
    for (const line of sale.lines) {
      const cost = costFor(sale, line, bought, decision);
      if (!cost) continue;
      costs.set(`${sale.id}:${line.position}`, cost);
      const confirmed = decision(cost.doc) === 'confirmed';
      const score = cost.by === 'item' ? 100 : 80;
      const before = links.get(pair(cost.doc));
      if (before && before.score >= score) continue;
      links.set(pair(cost.doc), {
        kind: 'cost',
        fromDocId: cost.doc.id,
        toDocId: sale.id,
        score: confirmed ? 100 : score,
        method: confirmed ? 'human' : cost.by === 'item' ? 'item' : 'similarity',
        status: confirmed ? 'confirmed' : 'auto',
      });
    }
  }
  return { costs, links: [...links.values()] };
}
