// How the memory finds the links between its pages (memory doc §7), from the surest: an identifier
// the document carries (exact: its company, its chantier, BT-11, the order or quote number of BT-13
// and BT-14, the situation before it, a line's article), a match on the data (strong: the same
// company, an amount within 2 %, dates within 30 days or the same chantier; an article by its code
// or its name), a reading of its text (inferred: the sentence is quoted, and a person confirms the
// link before anything relies on it). A rule links only to a page that exists, and only when one
// page fits; when several amounts fit, the closest is only a guess. A model's link comes in a patch,
// inferred, with its quote: it is kept, as is a person's
// confirmation or refusal. The writer runs the rules at every write, then on the pages that were
// waiting for the pages written (`LinkIndex.dependents`).
import { frMoney } from '@fi/core';
import { t } from '@fi/shared';
import type { PageFacts } from './compile';
import { fold, keyOf, terms } from './fold';
import {
  LINK_RULES,
  type Link,
  type LinkConfidence,
  type LinkKind,
  type LinkRule,
  type PageType,
} from './types';

/** A page as the rules read it. */
export interface Linkable {
  path: string;
  frontmatter: PageFacts;
  text: string;
}

const RANK: Record<LinkConfidence, number> = { inferred: 0, strong: 1, exact: 2 };
/** An amount within 2 %, a date within 30 days (memory doc §7). */
const AMOUNT_TOLERANCE = 0.02;
const DAYS = 30;
/** An article's name read in a line: this share of its words, two at least, is a guess. */
const WORDS_SHARE = 0.6;

const linkKey = (l: { kind: string; to: string }) => `${l.kind} ${l.to}`;
const money = (cents: number) => frMoney(cents, 'EUR');
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;
const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * AMOUNT_TOLERANCE;
const NUMBER = /\b[A-Z]{1,5}[-/ ]?\d[\w/-]*\b/g;
const TEXT_TYPES: readonly PageType[] = [
  'facture_vente',
  'facture_achat',
  'avoir',
  'devis',
  'commande',
  'document',
];

const partyOf = (f: PageFacts) => ('party' in f ? f.party : undefined);
const siteField = (f: PageFacts) => ('chantier' in f ? f.chantier : undefined);
const linesOf = (f: PageFacts) => ('lines' in f ? (f.lines ?? []) : []);
const rolesOf = (page: Linkable | undefined) =>
  page?.frontmatter.type === 'tiers' ? page.frontmatter.roles : [];

/** What a page's rules read of other pages, and what a write of it changes for them. */
function reads(page: Linkable): string[] {
  const f = page.frontmatter;
  const out: string[] = [];
  const party = partyOf(f);
  const site = siteField(f);
  if (party) out.push(`page:${party}`);
  if (site) out.push(`page:${site}`);
  if (f.type === 'facture_vente' || f.type === 'facture_achat' || f.type === 'avoir') {
    if (f.project_ref) out.push(`ref:${keyOf(f.project_ref)}`);
    for (const ref of [f.order_ref, f.sales_order_ref]) if (ref) out.push(`number:${keyOf(ref)}`);
    out.push(`party:${f.type === 'facture_achat' ? 'commande' : 'devis'} ${f.party}`);
  }
  if (f.type === 'situation' && f.number > 1) out.push(`situation:${f.chantier} ${f.number - 1}`);
  if (linesOf(f).length) out.push('articles');
  if (TEXT_TYPES.includes(f.type)) out.push('chantiers');
  if (f.type === 'article') for (const s of f.suppliers ?? []) out.push(`page:${s}`);
  if (f.type === 'tiers') {
    out.push(`party:document ${page.path}`, `party:facture_achat ${page.path}`);
  }
  return out;
}

function touches(page: Linkable): string[] {
  const f = page.frontmatter;
  const out = [`page:${page.path}`];
  const party = partyOf(f);
  if (party) out.push(`party:${f.type} ${party}`);
  if (f.type === 'devis' || f.type === 'commande') out.push(`number:${keyOf(f.number)}`);
  if (f.type === 'chantier') {
    out.push('chantiers');
    if (f.erp_ref) out.push(`ref:${keyOf(f.erp_ref)}`);
  }
  if (f.type === 'situation') out.push(`situation:${f.chantier} ${f.number}`);
  if (f.type === 'article') out.push('articles');
  return out;
}

interface Views {
  byType: Map<string, Linkable[]>;
  byParty: Map<string, Linkable[]>;
  numbers: Map<string, Linkable[]>;
  refs: Map<string, Linkable[]>;
  situations: Map<string, Linkable[]>;
  codes: Map<string, Linkable[]>;
  waiting: Map<string, string[]>;
}

const push = <V>(map: Map<string, V[]>, key: string, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** The pages the rules look among, and who waits for what. */
export class LinkIndex {
  readonly #pages = new Map<string, Linkable>();
  #views: Views | undefined;

  constructor(pages: Iterable<Linkable> = []) {
    for (const p of pages) this.#pages.set(p.path, p);
  }

  get(path: string): Linkable | undefined {
    return this.#pages.get(path);
  }

  values(): IterableIterator<Linkable> {
    return this.#pages.values();
  }

  put(page: Linkable): void {
    this.#pages.set(page.path, page);
    this.#views = undefined;
  }

  remove(path: string): void {
    this.#pages.delete(path);
    this.#views = undefined;
  }

  #view(): Views {
    if (this.#views) return this.#views;
    const v: Views = {
      byType: new Map(),
      byParty: new Map(),
      numbers: new Map(),
      refs: new Map(),
      situations: new Map(),
      codes: new Map(),
      waiting: new Map(),
    };
    // In path order, so that the first of several evidences is always the same one.
    const sorted = [...this.#pages.values()].sort((a, b) => a.path.localeCompare(b.path));
    for (const p of sorted) {
      const f = p.frontmatter;
      push(v.byType, f.type, p);
      const party = partyOf(f);
      if (party) push(v.byParty, `${f.type} ${party}`, p);
      if (f.type === 'devis' || f.type === 'commande') {
        push(v.numbers, `${f.type} ${keyOf(f.number)}`, p);
      }
      if (f.type === 'chantier' && f.erp_ref) push(v.refs, keyOf(f.erp_ref), p);
      if (f.type === 'situation') push(v.situations, `${f.chantier} ${f.number}`, p);
      if (f.type === 'article') for (const c of f.codes ?? []) push(v.codes, keyOf(c), p);
      for (const token of reads(p)) push(v.waiting, token, p.path);
    }
    this.#views = v;
    return v;
  }

  ofType(type: PageType): Linkable[] {
    return this.#view().byType.get(type) ?? [];
  }

  /** The pages of `type` whose company is `party`. */
  ofParty(type: PageType, party: string): Linkable[] {
    return this.#view().byParty.get(`${type} ${party}`) ?? [];
  }

  numbered(type: 'devis' | 'commande', number: string): Linkable[] {
    return this.#view().numbers.get(`${type} ${keyOf(number)}`) ?? [];
  }

  chantiersByRef(ref: string): Linkable[] {
    return this.#view().refs.get(keyOf(ref)) ?? [];
  }

  situations(chantier: string, number: number): Linkable[] {
    return this.#view().situations.get(`${chantier} ${number}`) ?? [];
  }

  articlesByCode(code: string): Linkable[] {
    return this.#view().codes.get(keyOf(code)) ?? [];
  }

  /**
   * The pages whose rules read what a write of `pages` changed (their versions before and after),
   * those pages left out.
   */
  dependents(pages: readonly Linkable[]): string[] {
    const { waiting } = this.#view();
    const own = new Set(pages.map((p) => p.path));
    const out = new Set<string>();
    for (const token of new Set(pages.flatMap(touches))) {
      for (const path of waiting.get(token) ?? []) if (!own.has(path)) out.add(path);
    }
    return [...out].sort();
  }
}

/** The chantier a document names: its field, or the one its BT-11 reference names. */
function siteOf(page: Linkable, index: LinkIndex): string | undefined {
  const f = page.frontmatter;
  const site = siteField(f);
  if (site) return site;
  if (
    (f.type === 'facture_vente' || f.type === 'facture_achat' || f.type === 'avoir') &&
    f.project_ref
  ) {
    const found = index.chantiersByRef(f.project_ref);
    if (found.length === 1) return found[0]?.path;
  }
  return undefined;
}

/** The sentence of `text` that `holds` (read folded), quoted for a link's evidence. */
function sentence(text: string, holds: (folded: string) => boolean): string | undefined {
  for (const s of text.split(/(?<=[.!?;])\s+|\n+/)) {
    if (holds(` ${fold(s)} `)) return t('memory.evidence.text', { quote: s.trim().slice(0, 200) });
  }
  return undefined;
}

/**
 * What an amount names among `candidates` (all within the dates already): the only one within 2 %,
 * or the only one of several equal to the cent, sure; the closest of several, a guess; none when two
 * are as close.
 */
function byAmount(
  ht: number,
  candidates: readonly { item: Linkable; ht: number }[],
): { item: Linkable; ht: number; sure: boolean; of: number } | undefined {
  const fit = candidates.filter((c) => near(ht, c.ht));
  const same = fit.filter((c) => c.ht === ht);
  const sure = fit.length === 1 ? fit[0] : same.length === 1 ? same[0] : undefined;
  if (sure) return { ...sure, sure: true, of: fit.length };
  const closest = best(fit.map((c) => ({ item: c, score: -Math.abs(ht - c.ht) })));
  return closest && { ...closest, sure: false, of: fit.length };
}

/** The one candidate with the highest score, none when two share it. */
function best<T>(scored: readonly { item: T; score: number }[]): T | undefined {
  const top = Math.max(...scored.map((s) => s.score));
  const at = scored.filter((s) => s.score === top);
  return at.length === 1 ? at[0]?.item : undefined;
}

type Line = ReturnType<typeof linesOf>[number];

/** The article a line names: its page, its code, its full name, or most of its name (a guess). */
function articleOf(
  line: Line,
  page: Linkable,
  index: LinkIndex,
): { to: string; rule: LinkRule; evidence: string } | undefined {
  const label = line.label;
  if (line.article) {
    return {
      to: line.article,
      rule: 'line_article',
      evidence: t('memory.evidence.line', { label }),
    };
  }
  const f = page.frontmatter;
  if (line.code) {
    // A supplier's code is its own: on a purchase, only that supplier's articles.
    const found = index.articlesByCode(line.code).filter((a) => {
      const suppliers = a.frontmatter.type === 'article' ? (a.frontmatter.suppliers ?? []) : [];
      return f.type !== 'facture_achat' || !suppliers.length || suppliers.includes(f.party);
    });
    if (found.length === 1 && found[0]) {
      const evidence = t('memory.evidence.lineCode', { code: line.code, label });
      return { to: found[0].path, rule: 'line_code', evidence };
    }
  }
  const words = new Set(terms(label));
  const full: { item: Linkable; score: number }[] = [];
  const part: { item: Linkable; score: number }[] = [];
  for (const a of index.ofType('article')) {
    const title = terms(a.frontmatter.title);
    const shared = title.filter((w) => words.has(w)).length;
    if (
      fold(label) === fold(a.frontmatter.title) ||
      (title.length >= 2 && shared === title.length)
    ) {
      full.push({ item: a, score: title.length });
    } else if (shared >= 2 && shared / title.length >= WORDS_SHARE) {
      part.push({ item: a, score: shared });
    }
  }
  const named = best(full);
  if (named) {
    return { to: named.path, rule: 'line_name', evidence: t('memory.evidence.line', { label }) };
  }
  if (full.length) return undefined;
  const guessed = best(part);
  if (guessed) {
    const evidence = t('memory.evidence.text', { quote: label });
    return { to: guessed.path, rule: 'line_words', evidence };
  }
  return undefined;
}

function partyKind(f: PageFacts, index: LinkIndex): LinkKind {
  switch (f.type) {
    case 'facture_achat':
      return 'issued_by';
    case 'avoir':
      return rolesOf(index.get(f.party)).includes('client') ? 'issued_to' : 'issued_by';
    case 'attestation_vigilance':
    case 'kbis':
    case 'attestation_assurance_decennale':
    case 'attestation_assurance_rc':
      return 'covers';
    default:
      return 'issued_to';
  }
}

/** The links the rules find for `page` now, the surest first when two rules find the same. */
export function ruleLinks(page: Linkable, index: LinkIndex): Link[] {
  const f = page.frontmatter;
  const refused = new Set((f.refused_links ?? []).map(linkKey));
  const found = new Map<string, Link>();
  const add = (kind: LinkKind, to: string | undefined, rule: LinkRule, evidence: string) => {
    if (!to || to === page.path || !index.get(to) || refused.has(`${kind} ${to}`)) return;
    const was = found.get(`${kind} ${to}`);
    if (was && RANK[was.confidence] >= RANK[LINK_RULES[rule]]) return;
    found.set(`${kind} ${to}`, { kind, to, confidence: LINK_RULES[rule], evidence, rule });
  };
  const has = (kind: LinkKind, type: PageType) =>
    [...found.values()].some((l) => l.kind === kind && index.get(l.to)?.frontmatter.type === type);

  const party = partyOf(f);
  if (party) add(partyKind(f, index), party, 'party', t('memory.evidence.party'));
  add('belongs_to', siteField(f), 'chantier', t('memory.evidence.chantier'));

  if (f.type === 'facture_vente' || f.type === 'facture_achat' || f.type === 'avoir') {
    if (f.project_ref) {
      const sites = index.chantiersByRef(f.project_ref);
      if (sites.length === 1) {
        const evidence = t('memory.evidence.projectRef', { ref: f.project_ref });
        add('belongs_to', sites[0]?.path, 'project_ref', evidence);
      }
    }
    if (f.type === 'facture_achat' && f.order_ref) {
      const orders = index
        .numbered('commande', f.order_ref)
        .filter((c) => partyOf(c.frontmatter) === f.party);
      if (orders.length === 1) {
        const evidence = t('memory.evidence.orderRef', { ref: f.order_ref });
        add('fulfils', orders[0]?.path, 'order_ref', evidence);
      }
    }
    if (f.type !== 'facture_achat') {
      for (const [field, ref] of [
        ['BT-13', f.order_ref],
        ['BT-14', f.sales_order_ref],
      ] as const) {
        if (!ref) continue;
        const quotes = index
          .numbered('devis', ref)
          .filter((d) => partyOf(d.frontmatter) === f.party);
        if (quotes.length === 1) {
          add(
            'fulfils',
            quotes[0]?.path,
            'quote_ref',
            t('memory.evidence.quoteRef', { ref, field }),
          );
        }
      }
    }
  }
  if (f.type === 'situation' && f.number > 1) {
    const before = index.situations(f.chantier, f.number - 1);
    if (before.length === 1) {
      const evidence = t('memory.evidence.previousSituation', { number: f.number - 1 });
      add('succeeds', before[0]?.path, 'previous_situation', evidence);
    }
  }
  for (const line of linesOf(f)) {
    const article = articleOf(line, page, index);
    if (article) add('uses', article.to, article.rule, article.evidence);
  }
  if (f.type === 'article') {
    for (const s of f.suppliers ?? [])
      add('supplied_by', s, 'supplier', t('memory.evidence.supplier'));
  }
  if (f.type === 'tiers') {
    for (const d of index.ofParty('document', page.path)) {
      if (d.frontmatter.type !== 'document' || d.frontmatter.kind !== 'contrat_sous_traitance')
        continue;
      const evidence = t('memory.evidence.contract', { path: d.path });
      add('works_on', siteOf(d, index), 'contract_site', evidence);
    }
    if (f.roles.includes('sous_traitant')) {
      for (const inv of index.ofParty('facture_achat', page.path)) {
        const evidence = t('memory.evidence.invoiceSite', { path: inv.path });
        add('works_on', siteOf(inv, index), 'invoice_site', evidence);
      }
    }
  }

  // A match on the data, when no identifier said it: within 2 % and 30 days.
  let guess: { to: string; rule: LinkRule; evidence: string } | undefined;
  const match = (
    candidates: readonly Linkable[],
    ht: number,
    issued: string,
    kind: 'order' | 'quote',
  ) => {
    const site = siteOf(page, index);
    const found = byAmount(
      ht,
      candidates.flatMap((c) => {
        const o = c.frontmatter;
        if ((o.type !== 'commande' && o.type !== 'devis') || o.ht === undefined) return [];
        if (o.type === 'devis' && o.status !== 'accepte') return [];
        const other = siteOf(c, index);
        const days = daysBetween(o.date, issued);
        if ((site && other && site !== other) || days < 0 || days > DAYS) return [];
        return [{ item: c, ht: o.ht }];
      }),
    );
    if (!found) return;
    const params = { ht: money(ht), other: money(found.ht), count: found.of };
    if (found.sure) {
      const evidence = t(`memory.evidence.${kind}${found.of > 1 ? 'Same' : 'Match'}`, params);
      add('fulfils', found.item.path, `${kind}_match`, evidence);
    } else {
      const evidence = t(`memory.evidence.${kind}Near`, params);
      guess = { to: found.item.path, rule: `${kind}_near`, evidence };
    }
  };
  if (f.type === 'facture_achat' && !has('fulfils', 'commande')) {
    match(index.ofParty('commande', f.party), f.ht, f.issue_date, 'order');
  }
  if (f.type === 'facture_vente' && !has('fulfils', 'devis')) {
    match(index.ofParty('devis', f.party), f.ht, f.issue_date, 'quote');
  }

  // A reading of the text: a guess, its sentence quoted.
  if ((f.type === 'facture_vente' || f.type === 'avoir') && !has('fulfils', 'devis')) {
    const numbers = [...new Set([...page.text.matchAll(NUMBER)].map((m) => m[0]))];
    const quotes = numbers.flatMap((n) =>
      index.numbered('devis', n).filter((d) => partyOf(d.frontmatter) === f.party),
    );
    const quote =
      quotes.length === 1 && quotes[0]?.frontmatter.type === 'devis' ? quotes[0] : undefined;
    if (quote?.frontmatter.type === 'devis') {
      const number = ` ${fold(quote.frontmatter.number)} `;
      const evidence = sentence(page.text, (s) => s.includes(number));
      if (evidence) add('fulfils', quote.path, 'text_quote', evidence);
    }
  }
  if (guess && !has('fulfils', f.type === 'facture_achat' ? 'commande' : 'devis')) {
    add('fulfils', guess.to, guess.rule, guess.evidence);
  }
  if (TEXT_TYPES.includes(f.type) && !has('belongs_to', 'chantier')) {
    const words = new Set(terms(page.text));
    const named = best(
      index.ofType('chantier').flatMap((c) => {
        const title = terms(c.frontmatter.title);
        return title.length >= 2 && title.every((w) => words.has(w))
          ? [{ item: c, score: title.length }]
          : [];
      }),
    );
    if (named) {
      const title = terms(named.frontmatter.title);
      const evidence = sentence(page.text, (s) => title.every((w) => s.includes(` ${w} `)));
      if (evidence) add('belongs_to', named.path, 'text_chantier', evidence);
    }
  }
  return [...found.values()];
}

/** A link a person stands behind: confirmed, or raised above what its rule makes. */
export const confirmed = (l: Link) =>
  l.confirmed_by !== undefined ||
  (l.rule !== undefined && RANK[l.confidence] > RANK[LINK_RULES[l.rule]]);

/**
 * The page's links as they should be: the rules' now, and what no rule makes (a model's guess, a
 * person's confirmation), the surer kept when both name the same target; in a fixed order.
 */
export function linksOf(page: Linkable, index: LinkIndex): Link[] {
  const out = new Map(ruleLinks(page, index).map((l) => [linkKey(l), l]));
  const refused = new Set((page.frontmatter.refused_links ?? []).map(linkKey));
  for (const l of page.frontmatter.links ?? []) {
    if ((l.rule && !confirmed(l)) || refused.has(linkKey(l))) continue;
    const was = out.get(linkKey(l));
    if (!was || RANK[l.confidence] > RANK[was.confidence]) out.set(linkKey(l), l);
  }
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.to.localeCompare(b.to));
}

const linkLine = (l: Link) =>
  [l.kind, l.to, l.confidence, l.evidence, l.rule ?? '', l.confirmed_by ?? ''].join('\u0001');

export const sameLinks = (a: readonly Link[], b: readonly Link[]) =>
  a.length === b.length && a.every((l, i) => linkLine(l) === linkLine(b[i] as Link));

/** `facts` with `links` in place of its own (none written when there are none). */
export function withLinks(facts: PageFacts, links: readonly Link[]): PageFacts {
  const { links: _old, ...rest } = facts;
  return (links.length ? { ...rest, links: [...links] } : rest) as PageFacts;
}

/**
 * `facts` as a patch gives them, with a person's word on the page's links kept (the links they
 * confirmed, those they refused) unless the patch says otherwise: a model or the ERP writes a page's
 * facts again, never what a person said.
 */
export function keepWord(facts: PageFacts, was: Linkable | undefined): PageFacts {
  if (!was) return facts;
  const own = new Set((facts.links ?? []).map(linkKey));
  const kept = (was.frontmatter.links ?? []).filter((l) => confirmed(l) && !own.has(linkKey(l)));
  const refused = facts.refused_links ?? was.frontmatter.refused_links;
  const out = kept.length ? withLinks(facts, [...(facts.links ?? []), ...kept]) : facts;
  return (refused ? { ...out, refused_links: refused } : out) as PageFacts;
}

/** Every page with its links found again, as a whole set of pages is written at once. */
export function relink<T extends Linkable>(pages: readonly T[]): T[] {
  const index = new LinkIndex(pages);
  return pages.map((p) => ({ ...p, frontmatter: withLinks(p.frontmatter, linksOf(p, index)) }));
}
