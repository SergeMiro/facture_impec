// Lint of the memory (memory doc §4 and §9). The links (M2): a link its target does not show back,
// or a backlink no link makes; a link to a page that is not there; a rule's link whose fact is gone
// (the rules no longer make it, or make it by another rule, so its evidence names what is not there);
// a link nobody accounts for (exact or strong with no rule and no person behind it, or a guess whose
// quote is not in its page). The rest (M5): a page's amounts or dates that contradict each other or
// another page, a `raw/` source that is gone, a section index that no longer says what its pages say,
// a dated page whose deadline nobody follows, a page recall keeps finding only in the whole text.
// Each finding carries its fix: what code can mend waits for a person's approval, the rest becomes an
// open question. Lint only reads.
import { frDate, frMoney } from '@fi/core';
import { t } from '@fi/shared';
import { fold } from './fold';
import { indexLine, readIndexLines, sectionIndex } from './indexes';
import { confirmed, LinkIndex, ruleLinks } from './link-rules';
import type { Page } from './page';
import { type Frontmatter, type LinkKind, SECTIONS, type Section, sectionOf } from './types';

export type LintCode = 'one_sided' | 'dangling' | 'stale' | 'unsourced';

export interface LintFinding {
  code: LintCode;
  /** The page whose frontmatter holds the line. */
  page: string;
  kind: LinkKind;
  /** The page at the other end. */
  other: string;
  /** A link the page makes, or a backlink it shows. */
  side: 'link' | 'backlink';
}

/** What a guess quotes: its evidence without the French quotation marks. */
const quoted = (evidence: string) => /^«\s*([\s\S]*?)\s*»$/.exec(evidence)?.[1] ?? evidence;

/** Every defect of the links of `pages`, page by page. */
export function lintLinks(pages: readonly Page[]): LintFinding[] {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const index = new LinkIndex(pages);
  const out: LintFinding[] = [];
  for (const page of pages) {
    const derived = new Set(ruleLinks(page, index).map((l) => `${l.kind} ${l.to} ${l.rule}`));
    const text = fold(page.text);
    for (const l of page.frontmatter.links ?? []) {
      const at = { page: page.path, kind: l.kind, other: l.to, side: 'link' } as const;
      const target = byPath.get(l.to);
      if (!target) {
        out.push({ code: 'dangling', ...at });
        continue;
      }
      const back = target.frontmatter.backlinks ?? [];
      if (!back.some((b) => b.kind === l.kind && b.from === page.path)) {
        out.push({ code: 'one_sided', ...at });
      }
      if (confirmed(l)) continue;
      if (l.rule && !derived.has(`${l.kind} ${l.to} ${l.rule}`)) out.push({ code: 'stale', ...at });
      const quote = fold(quoted(l.evidence));
      if (!l.rule && (l.confidence !== 'inferred' || !quote || !text.includes(quote))) {
        out.push({ code: 'unsourced', ...at });
      }
    }
    for (const b of page.frontmatter.backlinks ?? []) {
      const from = byPath.get(b.from);
      if (!from?.frontmatter.links?.some((l) => l.kind === b.kind && l.to === page.path)) {
        out.push({
          code: 'one_sided',
          page: page.path,
          kind: b.kind,
          other: b.from,
          side: 'backlink',
        });
      }
    }
  }
  return out;
}

/** The codes of the whole memory's lint (M5): the links' and the others. */
export type MemoryLintCode =
  | LintCode
  | 'contradiction'
  | 'missing_source'
  | 'stale_index'
  | 'no_deadline'
  | 'misplaced';

/**
 * What mends a finding: the vault rebuilt (backlinks and indexes written again), the rules' links
 * made again, a link to nothing dropped; or a question to a person, when only a person knows.
 */
export const LINT_FIXES = ['reindex', 'relink', 'drop_link', 'question'] as const;
export type LintFix = (typeof LINT_FIXES)[number];

export interface MemoryFinding {
  code: MemoryLintCode;
  /** The page it is about, or a section's index file. */
  page: string;
  /** What exactly, in code's words: the same defect gives the same detail from one lint to the next. */
  detail: string;
  fix: LintFix;
  /** The link a `drop_link` removes. */
  link?: { kind: LinkKind; to: string };
  /** What a person reads. */
  text: string;
}

export interface LintInput {
  pages: readonly Page[];
  /** Each section's index file as it is now; null when there is none. */
  indexes: Readonly<Record<Section, string | null>>;
  /** The files of `raw/`, vault-relative (`raw/2026/01/facture.eml`). */
  raw: ReadonlySet<string>;
  /** Today in Paris, ISO. */
  today: string;
  /** The company's SIREN and the keys of the deadlines it follows (without `test:`). */
  deadlines?: { own: string; keys: ReadonlySet<string> } | undefined;
  /** What recall found lately (30 days): at which level, which pages. */
  recalls?: readonly { level: number; found: readonly string[] }[] | undefined;
}

/** A page recall found this often at level 4 or 5 is filed where its key does not show. */
export const MISPLACED_RECALLS = 3;

const LINK_FIX: Record<LintCode, LintFix> = {
  one_sided: 'reindex',
  dangling: 'drop_link',
  stale: 'relink',
  unsourced: 'question',
};

const money = (cents: number) => frMoney(cents, 'EUR');

type Of<T extends Frontmatter['type']> = Extract<Frontmatter, { type: T }>;
type Line = NonNullable<Of<'devis'>['lines']>[number];

/** Every amount a page states, in cents: what its text may quote. */
function amountsOf(f: Frontmatter): Set<number> {
  const out = new Set<number>();
  const add = (v: unknown) => {
    if (typeof v === 'number') out.add(v);
  };
  const record = f as Record<string, unknown>;
  for (const k of ['ht', 'tva', 'ttc', 'cumul_ht', 'retenue', 'last_price']) add(record[k]);
  for (const l of (record.lines as Line[] | undefined) ?? []) {
    add(l.amount);
    add(l.unit_price);
  }
  return out;
}

/** « 8 404,80 € TTC » in a page's text: an amount it claims. */
const TEXT_AMOUNT = /(\d{1,3}(?:[   ]\d{3})+|\d+),(\d{2})\s?€\s?(?:HT|TTC)\b/g;

function contradictions(pages: readonly Page[]): MemoryFinding[] {
  const out: MemoryFinding[] = [];
  const say = (page: Page, kind: string, extra: string, params: Record<string, string | number>) =>
    out.push({
      code: 'contradiction',
      page: page.path,
      detail: extra ? `${kind} ${extra}` : kind,
      fix: 'question',
      text: t(`memory.lint.contradiction.${kind}` as 'memory.lint.contradiction.amounts', params),
    });
  const order = (page: Page, field: string, date: string | undefined, from: string) => {
    if (date && date < from) {
      say(page, 'dates', field, {
        field: t(`memory.lint.field.${field}` as 'memory.lint.field.due_date'),
        date: frDate(date),
        from: frDate(from),
      });
    }
  };
  const lines = (page: Page, list: readonly Line[] | undefined, ht: number | undefined) => {
    if (!list?.length || ht === undefined) return;
    const sum = list.reduce((s, l) => s + l.amount, 0);
    if (sum !== ht) say(page, 'lines', '', { sum: money(sum), ht: money(ht) });
  };

  const same = new Map<string, Page[]>();
  const situations = new Map<string, Page[]>();
  for (const page of pages) {
    const f = page.frontmatter;
    switch (f.type) {
      case 'facture_vente':
      case 'facture_achat':
      case 'avoir':
        if (f.ht + f.tva !== f.ttc) {
          say(page, 'amounts', '', { ht: money(f.ht), tva: money(f.tva), ttc: money(f.ttc) });
        }
        lines(page, f.lines, f.ht);
        order(page, 'due_date', f.due_date, f.issue_date);
        order(page, 'paid_at', f.paid_at, f.issue_date);
        break;
      case 'devis':
      case 'commande':
        lines(page, f.lines, f.ht);
        break;
      case 'situation':
        if (f.issue_date) order(page, 'due_date', f.due_date, f.issue_date);
        situations.set(f.chantier, [...(situations.get(f.chantier) ?? []), page]);
        break;
      case 'attestation_vigilance':
      case 'kbis':
      case 'attestation_assurance_decennale':
      case 'attestation_assurance_rc':
        order(page, 'valid_to', f.valid_to, f.valid_from);
        break;
      case 'chantier':
        if (f.start) order(page, 'reception_date', f.reception_date, f.start);
        break;
      case 'salarie':
        order(page, 'end', f.end, f.start);
        break;
    }
    if ('number' in f && 'party' in f && typeof f.number === 'string' && f.party) {
      const key = `${f.type} ${f.number} ${f.party}`;
      same.set(key, [...(same.get(key) ?? []), page]);
    }
    const stated = amountsOf(f);
    for (const m of page.text.matchAll(TEXT_AMOUNT)) {
      const cents = Number((m[1] ?? '').replace(/\D/g, '')) * 100 + Number(m[2]);
      if (!stated.has(cents)) say(page, 'text', String(cents), { amount: money(cents) });
    }
  }

  // Two pages of one document (same kind, number and company) that do not say the same.
  for (const group of same.values()) {
    if (group.length < 2) continue;
    const said = (p: Page) => {
      const f = p.frontmatter as Of<'devis'> | Of<'facture_vente'> | Of<'commande'>;
      return JSON.stringify([f.ht, 'ttc' in f ? f.ttc : null, 'date' in f ? f.date : f.issue_date]);
    };
    if (new Set(group.map(said)).size < 2) continue;
    for (const page of group) {
      const other = group.find((p) => p !== page)?.path ?? '';
      say(page, 'duplicate', other, { other });
    }
  }
  // A situation's cumul never goes down: each one states the work done so far.
  for (const list of situations.values()) {
    const sorted = list.sort(
      (a, b) =>
        (a.frontmatter as Of<'situation'>).number - (b.frontmatter as Of<'situation'>).number,
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as Page;
      const page = sorted[i] as Page;
      const [p, f] = [prev.frontmatter as Of<'situation'>, page.frontmatter as Of<'situation'>];
      if (f.cumul_ht < p.cumul_ht) {
        say(page, 'cumul', prev.path, {
          number: f.number,
          cumul: money(f.cumul_ht),
          prev: p.number,
          prevCumul: money(p.cumul_ht),
        });
      }
    }
  }
  return out;
}

/** The deadline a page should have in the company's list (`deriveObligations`' keys). */
function deadlineOf(
  page: Page,
  own: string,
  today: string,
  sirenOf: (path: string) => string | undefined,
): { key: string; due: string } | null {
  const f = page.frontmatter;
  switch (f.type) {
    case 'attestation_vigilance':
    case 'kbis':
    case 'attestation_assurance_decennale':
    case 'attestation_assurance_rc': {
      const siren = sirenOf(f.party);
      if (!siren || f.valid_to < today) return null;
      const key = {
        attestation_vigilance: `attestation_vigilance_renouvellement:${siren}`,
        kbis: `kbis_renouvellement:${siren}`,
        attestation_assurance_decennale: `assurance_expiration:${siren}:decennale`,
        attestation_assurance_rc: `assurance_expiration:${siren}:rc`,
      }[f.type];
      return { key, due: f.valid_to };
    }
    case 'facture_vente':
      if (f.paid_at || !f.due_date || f.ttc <= 0) return null;
      return { key: `facture_echeance:${own}:${f.number}`, due: f.due_date };
    default:
      return null;
  }
}

/** Everything wrong with the memory as `input` holds it. */
export function lintMemory(input: LintInput): MemoryFinding[] {
  const { pages } = input;
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const out: MemoryFinding[] = [];

  for (const f of lintLinks(pages)) {
    const fix = LINK_FIX[f.code];
    out.push({
      code: f.code,
      page: f.page,
      detail: `${f.side} ${f.kind} ${f.other}`,
      fix,
      ...(fix === 'drop_link' && { link: { kind: f.kind, to: f.other } }),
      text: t(`memory.lint.${f.code}`, { label: t(`memory.link.${f.kind}`), other: f.other }),
    });
  }

  out.push(...contradictions(pages));

  for (const page of pages) {
    for (const ref of page.frontmatter.sources) {
      if (!ref.startsWith('raw/') || input.raw.has(ref)) continue;
      const text = t('memory.lint.missing_source', { ref });
      out.push({ code: 'missing_source', page: page.path, detail: ref, fix: 'question', text });
    }
  }

  for (const section of SECTIONS) {
    const want = pages
      .filter((p) => sectionOf(p.path) === section)
      .map(indexLine)
      .sort();
    const file = input.indexes[section];
    if (file === null && want.length === 0) continue;
    const have = readIndexLines(file ?? '').sort();
    if (have.length === want.length && have.every((l, i) => l === want[i])) continue;
    out.push({
      code: 'stale_index',
      page: sectionIndex(section),
      detail: section,
      fix: 'reindex',
      text: t('memory.lint.stale_index', { section: t(`memory.section.${section}`) }),
    });
  }

  if (input.deadlines) {
    const { own, keys } = input.deadlines;
    const sirenOf = (path: string) => {
      const f = byPath.get(path)?.frontmatter;
      return f?.type === 'tiers' ? f.siren : undefined;
    };
    for (const page of pages) {
      const due = deadlineOf(page, own, input.today, sirenOf);
      if (!due || keys.has(due.key)) continue;
      out.push({
        code: 'no_deadline',
        page: page.path,
        detail: due.key,
        fix: 'question',
        text: t('memory.lint.no_deadline', { date: frDate(due.due) }),
      });
    }
  }

  if (input.recalls) {
    const deep = new Map<string, number>();
    for (const r of input.recalls) {
      if (r.level !== 4 && r.level !== 5) continue;
      for (const path of new Set(r.found)) deep.set(path, (deep.get(path) ?? 0) + 1);
    }
    for (const [path, count] of [...deep].sort(([a], [b]) => a.localeCompare(b))) {
      if (count < MISPLACED_RECALLS || !byPath.has(path)) continue;
      out.push({
        code: 'misplaced',
        page: path,
        detail: 'recall',
        fix: 'question',
        text: t('memory.lint.misplaced', { count }),
      });
    }
  }
  return out;
}
