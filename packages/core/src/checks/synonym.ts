// Article synonyms (R7): two articles of the registry that are one — a supplier's « GM chaise chêne »
// and the company's « Chaise chêne ». A person ties them with « Oui » on a proposal; from then on every
// rule reads the bought one as the sold one, and B2 finds its cost. Proposals come from names only: a
// sold article no purchase gives a cost to, and a bought article whose name shares its words.
import { type Cost, isPurchase, normalizeName, unitOf } from './cost';
import { isInvoice } from './link';
import type { CheckDoc, SynonymDecision, SynonymProposal } from './types';

/** A proposal needs this share of the shorter name's words. */
export const SYNONYM_SCORE = 60;
/** Proposals per check: a person answers a few at a time. */
export const MAX_SYNONYMS = 20;

export const synonymId = (s: { itemId: string; aliasId: string }) => `${s.itemId}~${s.aliasId}`;

/** The documents with every confirmed alias read as its article; a chain is followed to its end. */
export function applySynonyms(
  docs: readonly CheckDoc[],
  decisions: readonly SynonymDecision[],
): CheckDoc[] {
  const to = new Map(
    decisions.filter((d) => d.status === 'confirmed').map((d) => [d.aliasId, d.itemId]),
  );
  if (to.size === 0) return [...docs];
  const resolve = (id: string) => {
    let at = id;
    // A loop of answers (A is B, B is A) stops where it started.
    for (let i = 0; i < to.size; i++) {
      const next = to.get(at);
      if (!next || next === id) break;
      at = next;
    }
    return at;
  };
  return docs.map((d) =>
    d.lines.some((l) => l.itemId && to.has(l.itemId))
      ? {
          ...d,
          lines: d.lines.map((l) => (l.itemId ? { ...l, itemId: resolve(l.itemId) } : l)),
        }
      : d,
  );
}

/** The words of a name, a final s or x taken off: « Chaises chêne » → chaise, chene. */
function words(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter((w) => w.length > 1)
      .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w)),
  );
}

/** The share of the shorter name's words the other has, 0–100; two words at least when both have them. */
export function nameScore(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  const shorter = Math.min(x.size, y.size);
  if (shorter === 0) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  if (shared < Math.min(2, shorter)) return 0;
  return Math.round((100 * shared) / shorter);
}

interface Named {
  itemId: string;
  name: string;
  unit: string | null | undefined;
}

/**
 * The pairs to ask about: each sold article that some line sells with no cost, with the bought article
 * whose name is closest (same unit). A pair already answered is not asked again.
 */
export function proposeSynonyms(
  docs: readonly CheckDoc[],
  costs: ReadonlyMap<string, Cost>,
  decisions: readonly SynonymDecision[],
): SynonymProposal[] {
  const answered = new Set(decisions.map(synonymId));
  const bought = new Map<string, Named>();
  for (const doc of docs.filter(isPurchase)) {
    for (const l of doc.lines) {
      if (l.itemId && l.name && !bought.has(l.itemId)) {
        bought.set(l.itemId, { itemId: l.itemId, name: l.name, unit: l.unitCode });
      }
    }
  }
  if (bought.size === 0) return [];
  const sold = new Map<string, Named>();
  const costed = new Set<string>();
  for (const doc of docs.filter(isInvoice)) {
    if (doc.typeCode === '381' || doc.typeCode === '386') continue;
    for (const l of doc.lines) {
      if (!l.itemId || !l.name) continue;
      if (costs.has(`${doc.id}:${l.position}`)) costed.add(l.itemId);
      else if (!sold.has(l.itemId))
        sold.set(l.itemId, { itemId: l.itemId, name: l.name, unit: l.unitCode });
    }
  }
  const found: SynonymProposal[] = [];
  for (const s of sold.values()) {
    // An article that has a cost on another line already has its purchase.
    if (costed.has(s.itemId)) continue;
    let best: SynonymProposal | null = null;
    for (const b of bought.values()) {
      if (b.itemId === s.itemId || answered.has(synonymId({ itemId: s.itemId, aliasId: b.itemId })))
        continue;
      if (s.unit && b.unit && unitOf(s.unit) !== unitOf(b.unit)) continue;
      const score = nameScore(s.name, b.name);
      if (score < SYNONYM_SCORE || (best && best.score >= score)) continue;
      best = { itemId: s.itemId, aliasId: b.itemId, itemName: s.name, aliasName: b.name, score };
    }
    if (best) found.push(best);
  }
  return found
    .sort((a, b) => b.score - a.score || a.itemName.localeCompare(b.itemName))
    .slice(0, MAX_SYNONYMS);
}
