// Linker (R2): which order an invoice bills, which order a delivery note delivers. The order number
// first (score 100); else the same customer, the same articles and quantities within a window of
// dates. One clear candidate links on its own; several stay « proposée » for a person, and what a
// person decided is never undone here.
import { addDays } from '../dates';
import { isDecimal } from '../money';
import { partyKey } from '../party';
import type { CheckDoc, Link, LinkDecision, LinkKind, LinkMethod, LinkStatus } from './types';

/** Below it a candidate is not one. */
const MIN_SCORE = 50;
/** A candidate this far ahead of the next one is the one. */
const LEAD = 25;
/** At or above it a lone candidate links without asking. */
const AUTO_SCORE = 80;

export const linkId = (l: Pick<Link, 'kind' | 'fromDocId' | 'toDocId'>) =>
  `${l.kind}:${l.fromDocId}>${l.toDocId}`;

/** An order number as written: « c-118 », « C 118 », « C118 » and « C-118 » are the same. */
const numberKey = (s: string | null) => s?.replace(/[\s\-_./]+/g, '').toUpperCase() || null;

export const quantityOf = (s: string | null): number | null =>
  s !== null && isDecimal(s) ? Number(s) : null;

export const isInvoice = (d: CheckDoc) => d.kind === 'invoice' && d.direction === 'out';

/** True or false when both sides say who the customer is; null when one of them does not. */
export function sameParty(a: CheckDoc, b: CheckDoc): boolean | null {
  if (a.partySiren && b.partySiren) return a.partySiren === b.partySiren;
  const x = a.partyName ? partyKey(a.partyName) : '';
  const y = b.partyName ? partyKey(b.partyName) : '';
  return x && y ? x === y : null;
}

/** `date` within [base + from, base + to] days; a missing date excludes nothing. */
function within(date: string | null, base: string | null, from: number, to: number) {
  if (!date || !base) return true;
  return date >= addDays(base, from) && date <= addDays(base, to);
}

/** Quantity of each article on a document; null when a line of it has none. */
export function itemQuantities(doc: CheckDoc): Map<string, number | null> {
  const found = new Map<string, number | null>();
  for (const line of doc.lines) {
    if (!line.itemId) continue;
    const q = quantityOf(line.quantity);
    const before = found.get(line.itemId);
    found.set(line.itemId, before === null || q === null ? null : (before ?? 0) + q);
  }
  return found;
}

/**
 * How much of `a` is in `b`, 0–100: for each article of `a`, the smaller quantity over the larger one
 * (half when one side gives none), averaged over the articles of `a`. A partial invoice of an order
 * scores on what it bills.
 */
export function similarity(a: CheckDoc, b: CheckDoc): number {
  const qa = itemQuantities(a);
  const qb = itemQuantities(b);
  if (qa.size === 0) return 0;
  let total = 0;
  for (const [item, x] of qa) {
    if (!qb.has(item)) continue;
    const y = qb.get(item) ?? null;
    total += x === null || y === null || x <= 0 || y <= 0 ? 0.5 : Math.min(x, y) / Math.max(x, y);
  }
  return Math.round((100 * total) / qa.size);
}

export function linkDocs(docs: readonly CheckDoc[], decisions: readonly LinkDecision[]): Link[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const decided = new Map(decisions.map((d) => [linkId(d), d.status]));
  const links = new Map<string, Link>();
  const put = (l: Link) => {
    const id = linkId(l);
    // The first link found stands: a person's, then the number's, then the articles'.
    if (decided.get(id) !== 'rejected' && !links.has(id)) links.set(id, l);
  };
  // What a person confirmed stands, whatever is found below; the document it settles (the invoice
  // of an order, the delivery note) is not linked again.
  const settled = new Set<string>();
  for (const d of decisions) {
    const from = byId.get(d.fromDocId);
    if (d.status !== 'confirmed' || !from || !byId.has(d.toDocId)) continue;
    links.set(linkId(d), { ...d, score: 100, method: 'human', status: 'confirmed' });
    // A purchase's cost settles nothing here (src/checks/cost.ts).
    if (d.kind === 'cost') continue;
    settled.add(d.kind === 'billed_by' && from.kind === 'order' ? d.toDocId : d.fromDocId);
  }

  const invoices = docs.filter(isInvoice);
  const orders = docs.filter((d) => d.kind === 'order');
  const deliveries = docs.filter((d) => d.kind === 'delivery');
  const byNumber = (list: readonly CheckDoc[]) => {
    const found = new Map<string, CheckDoc[]>();
    for (const d of list) {
      const k = numberKey(d.number);
      if (k) found.set(k, [...(found.get(k) ?? []), d]);
    }
    return found;
  };
  const ordersByNumber = byNumber(orders);
  const deliveriesByNumber = byNumber(deliveries);
  const numbered = new Set<string>();
  /** Delivery notes an invoice names: billed already, whatever order they deliver. */
  const billedDirectly = new Set<string>();
  /** A person said « Non » to it: no candidate any more, the others are weighed without it. */
  const refused = (kind: LinkKind, subject: CheckDoc, target: CheckDoc) => {
    const [fromDocId, toDocId] = isInvoice(subject)
      ? [target.id, subject.id]
      : [subject.id, target.id];
    return decided.get(linkId({ kind, fromDocId, toDocId })) === 'rejected';
  };
  const linkAll = (kind: LinkKind, subject: CheckDoc, found: readonly CheckDoc[]) => {
    const targets = found.filter((t) => !refused(kind, subject, t));
    for (const t of targets) {
      const [fromDocId, toDocId] = kind === 'billed_by' ? [t.id, subject.id] : [subject.id, t.id];
      put({
        kind,
        fromDocId,
        toDocId,
        score: 100,
        method: 'number',
        status: targets.length === 1 ? 'auto' : 'proposed',
      });
    }
    if (targets.length > 0) numbered.add(subject.id);
    if (kind === 'billed_by') for (const t of targets) billedDirectly.add(t.id);
  };

  // 1. By number: the invoice's order (else a delivery note of that number), the note's order.
  for (const inv of invoices) {
    const k = numberKey(inv.orderRef);
    if (settled.has(inv.id) || !k) continue;
    const found = ordersByNumber.get(k);
    linkAll('billed_by', inv, found ?? deliveriesByNumber.get(k) ?? []);
  }
  for (const del of deliveries) {
    const k = numberKey(del.orderRef);
    if (settled.has(del.id) || !k) continue;
    linkAll('fulfils', del, ordersByNumber.get(k) ?? []);
  }

  // What the numbers already bill of each order: an order billed in full is no candidate on its own
  // for one more invoice, a person says whether that invoice bills it twice.
  const billed = new Map<string, Map<string, number>>();
  for (const l of links.values()) {
    if (l.kind !== 'billed_by' || (l.status !== 'auto' && l.status !== 'confirmed')) continue;
    const inv = byId.get(l.toDocId);
    if (!inv || inv.typeCode === '381' || inv.typeCode === '386') continue;
    const per = billed.get(l.fromDocId) ?? new Map<string, number>();
    for (const [item, q] of itemQuantities(inv)) per.set(item, (per.get(item) ?? 0) + (q ?? 0));
    billed.set(l.fromDocId, per);
  }
  const billedInFull = (order: CheckDoc, inv: CheckDoc) => {
    const per = billed.get(order.id);
    if (!per) return false;
    const ordered = itemQuantities(order);
    return [...itemQuantities(inv).keys()].every((item) => {
      const q = ordered.get(item);
      return q !== undefined && q !== null && (per.get(item) ?? 0) >= q;
    });
  };

  // 2. By customer, articles and quantities. The invoice is what an order is billed by; a delivery
  // note is the one that fulfils an order, or is billed by an invoice.
  const choose = (
    kind: LinkKind,
    subject: CheckDoc,
    candidates: readonly CheckDoc[],
    ask: (c: CheckDoc) => boolean = () => false,
  ): boolean => {
    const subjectIsFrom = !isInvoice(subject);
    const scored = candidates
      .filter((c) => !refused(kind, subject, c))
      .map((c) => ({ c, score: similarity(subject, c) }))
      .filter((s) => s.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : 1));
    const [best, second] = scored;
    if (!best) return false;
    const method = (score: number): LinkMethod => (score === 100 ? 'item' : 'similarity');
    const link = (c: CheckDoc, score: number, status: LinkStatus) => {
      const [fromDocId, toDocId] = subjectIsFrom ? [subject.id, c.id] : [c.id, subject.id];
      put({ kind, fromDocId, toDocId, score, method: method(score), status });
    };
    if (!second || best.score - second.score >= LEAD) {
      const alone = best.score >= AUTO_SCORE && !ask(best.c);
      link(best.c, best.score, alone ? 'auto' : 'proposed');
    } else {
      for (const s of scored.filter((s) => s.score > best.score - LEAD).slice(0, 3)) {
        link(s.c, s.score, 'proposed');
      }
    }
    return true;
  };

  for (const inv of invoices) {
    if (settled.has(inv.id) || numbered.has(inv.id) || inv.typeCode === '386') continue;
    const candidates = orders.filter(
      (o) => sameParty(inv, o) === true && within(inv.issueDate, o.issueDate, -30, 120),
    );
    choose('billed_by', inv, candidates, (o) => billedInFull(o, inv));
  }
  for (const del of deliveries) {
    if (settled.has(del.id) || numbered.has(del.id)) continue;
    const toOrder = orders.filter(
      (o) => sameParty(del, o) === true && within(del.issueDate, o.issueDate, -7, 180),
    );
    if (choose('fulfils', del, toOrder) || billedDirectly.has(del.id)) continue;
    // No order: the invoice that bills the delivery itself.
    const toInvoice = invoices.filter(
      (i) => sameParty(del, i) === true && within(i.issueDate, del.issueDate, -30, 120),
    );
    choose('billed_by', del, toInvoice);
  }
  return [...links.values()];
}
