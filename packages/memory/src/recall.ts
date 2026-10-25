// Reading the memory (memory doc §6): a search that goes down level by level and stops at the
// first sure answer. 1 a page by its key, 2 the pages one or two links away, 3 full-text in the
// section, 4 in the whole memory, 5 in the texts of `raw/` (an answer there is written back onto
// its page, so the same question is cheap next time), 6 « nothing », with what was searched. No
// level asks a model (docs/plans/memory.md): code finds the page and the line, or says it did not.
// An answer that leads to an action outward (`mustBeExhaustive`, and every `exists`) also looks for
// a page that says otherwise; one found makes the answer ambiguous and the action waits for a person.
import type { MemoryPageRow } from '@fi/db';
import { z } from 'zod';
import { fold, terms } from './fold';
import { KEY_KINDS, type KeyKind, keyString, type MemoryStore } from './store';
import { LinkKind, type PageType, SECTIONS, type Section, sectionOf, TYPE_SECTION } from './types';

const PAGE_TYPES = Object.keys(TYPE_SECTION) as [PageType, ...PageType[]];

export const RecallQuery = z.object({
  /** `fact` one answer, `list` every page that answers, `exists` whether there is one. */
  intent: z.enum(['fact', 'list', 'exists']),
  /** The question as asked, in French: its words feed full-text, the log and an open question. */
  question: z.string().min(1),
  /** The page it is about, by one of its keys; when none, keys are read from the question. */
  subject: z.object({ by: z.enum(KEY_KINDS), value: z.string().min(1) }).optional(),
  /** The kind of page that answers. */
  type: z.enum(PAGE_TYPES).optional(),
  /** Level 2 follows only these links. */
  via: z.array(LinkKind).optional(),
  /** The answer is this field of the page (`siren`, `due_date`, `ttc`). */
  field: z.string().min(1).optional(),
  /** …or a line of its text holding all these words (`iban`). */
  match: z.array(z.string().min(1)).optional(),
  /** Fields a page that answers has not filled (`paid_at` for what is still owed). */
  unset: z.array(z.string().min(1)).optional(),
  section: z.enum(SECTIONS).optional(),
  mustBeExhaustive: z.boolean().optional(),
});
export type RecallQuery = z.input<typeof RecallQuery>;

export type Level = 1 | 2 | 3 | 4 | 5 | 6;

/** Each level's time (memory doc §6), in milliseconds. */
export const LEVEL_BUDGET_MS: Record<Exclude<Level, 6>, number> = {
  1: 5,
  2: 3_000,
  3: 8_000,
  4: 15_000,
  5: 40_000,
};

const Hit = z.object({
  /** A page, or at level 5 the original in `raw/`. */
  path: z.string().min(1),
  title: z.string(),
  type: z.union([z.enum(PAGE_TYPES), z.literal('raw')]),
  sources: z.array(z.string()).min(1),
  value: z.unknown().optional(),
  line: z.string().optional(),
});
export type Hit = z.infer<typeof Hit>;

const Searched = z.object({ level: z.int().min(1).max(5), what: z.string(), found: z.int() });
export type Searched = z.infer<typeof Searched>;

/** What recall gives back; a caller accepts an answer only through this (memory doc §6). */
export const RecallAnswer = z
  .object({
    status: z.enum(['found', 'ambiguous', 'not_found']),
    level: z.int().min(1).max(6),
    hits: z.array(Hit),
    searched: z.array(Searched),
    /** The whole search, the check for a contradicting page included. */
    ms: z.number(),
    /** Down to the answer's level, before that check: what the level's budget is about. */
    levelMs: z.number(),
    /** Level 5: the line that answered, to write onto its page (none: no page cites it). */
    writeback: z
      .object({
        path: z.string().nullable(),
        ref: z.string(),
        line: z.string(),
        /** Set by the vault: whether the page took it (a person's edit in the minute keeps it out). */
        written: z.boolean().optional(),
      })
      .optional(),
    /** Level 4: the answer was not in the section it belongs to (for lint, M2). */
    misplaced: z.boolean().optional(),
    /** Ambiguous: the pages that disagree. */
    contradicts: z.array(z.string()).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.status !== 'not_found' && !a.hits.length) {
      ctx.addIssue({ code: 'custom', message: 'an answer without its pages' });
    }
    if (a.status === 'not_found' && (a.level !== 6 || !a.searched.length)) {
      ctx.addIssue({ code: 'custom', message: 'nothing found without what was searched' });
    }
  });
export type RecallAnswer = z.infer<typeof RecallAnswer>;

/** A word as found in folded text: at a word's start, a French plural tolerated. */
const stem = (w: string) => (w.length > 4 ? w.replace(/(es|s|x)$/, '') : w);
const holds = (folded: string, words: readonly string[]) => {
  const padded = ` ${folded}`;
  return words.every((w) => padded.includes(` ${stem(w)}`));
};

/** Identifiers written in a question: a SIREN, a SIRET, a VAT number, an e-mail, a number. */
function identifiersIn(question: string): { by: KeyKind; value: string }[] {
  const found: { by: KeyKind; value: string }[] = [];
  for (const m of question.matchAll(/\b\d{3} ?\d{3} ?\d{3}(?: ?\d{5})?\b/g)) {
    const digits = m[0].replace(/ /g, '');
    found.push({ by: digits.length === 9 ? 'siren' : 'siret', value: digits });
  }
  for (const m of question.matchAll(/\bFR ?[0-9A-Z]{2} ?\d{9}\b/gi)) {
    found.push({ by: 'vat_id', value: m[0] });
  }
  for (const m of question.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    found.push({ by: 'email', value: m[0] });
  }
  for (const m of question.matchAll(/\b[A-Z]{1,5}[-/ ]?\d[\w/-]*\b/gi)) {
    if (/[a-z]/i.test(m[0])) found.push({ by: 'number', value: m[0] });
  }
  return found;
}

/** The keys a question names: its identifiers, and any run of up to five words as a name. */
export function keysIn(question: string): string[] {
  const keys = identifiersIn(question).map((i) => keyString(i.by, i.value));
  // A name is any run of up to five words: « le SIREN de Marc Élec » holds `name:marc elec`.
  const words = fold(question).split(' ').filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 5 && i + n <= words.length; n++) {
      keys.push(`name:${words.slice(i, i + n).join(' ')}`);
    }
  }
  return [...new Set(keys)];
}

const filled = (v: unknown) =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** A line of `text` holding every one of `words`, the one holding most of them when `loose`. */
function lineOf(text: string, words: readonly string[], loose = false): string | undefined {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const all = lines.find((l) => holds(fold(l), words));
  if (all || !loose) return all;
  let best: { line: string; count: number } | undefined;
  for (const line of lines) {
    const count = words.filter((w) => holds(fold(line), [w])).length;
    if (count && (!best || count > best.count)) best = { line, count };
  }
  return best?.line;
}

export interface RecallOptions {
  /** Writes the line of the log table; on by default. */
  log?: boolean;
}

/** Searches the memory `store` for `input`, level after level. */
export async function recall(
  store: MemoryStore,
  input: RecallQuery,
  options: RecallOptions = {},
): Promise<RecallAnswer> {
  const q = RecallQuery.parse(input);
  const started = performance.now();
  const searched: Searched[] = [];
  const match = (q.match ?? []).flatMap(terms);
  const words = [...new Set([...match, ...terms(q.question)])];
  // What a page must speak of to be about the subject, at levels 3 to 5: the subject's words, or
  // the identifiers the question gives. With neither, nor words a line must hold, a page full-text
  // finds could be anyone's (« the SIREN » of which company?): the search ends after level 2.
  const about = q.subject
    ? terms(q.subject.value)
    : [...new Set(identifiersIn(q.question).flatMap((i) => terms(i.value)))];
  const checkable = about.length > 0 || match.length > 0;

  const answer = (row: MemoryPageRow): Hit | null => {
    if (q.type && row.type !== q.type) return null;
    const facts = row.facts as Record<string, unknown>;
    if (q.unset?.some((f) => filled(facts[f]))) return null;
    const hit: Hit = {
      path: row.path,
      title: row.title,
      type: row.type as PageType,
      sources: row.sources,
    };
    if (q.field) return filled(facts[q.field]) ? { ...hit, value: facts[q.field] } : null;
    if (match.length) {
      const line = lineOf(row.body, match);
      return line ? { ...hit, line } : null;
    }
    return hit;
  };
  const answers = (rows: readonly MemoryPageRow[], aboutOnly = false) =>
    rows
      .filter((r) => !aboutOnly || holds(r.folded, about))
      .map(answer)
      .filter((h): h is Hit => h !== null);

  const settle = async (
    level: Level,
    hits: Hit[],
    extra: Partial<RecallAnswer> = {},
  ): Promise<RecallAnswer> => {
    const levelMs = performance.now() - started;
    let status: RecallAnswer['status'] = hits.length ? 'found' : 'not_found';
    let contradicts: string[] | undefined;
    if (q.intent === 'fact' && hits.length > 1) {
      const said = new Set(hits.map((h) => JSON.stringify(h.value ?? h.line ?? h.path)));
      if (said.size > 1) {
        status = 'ambiguous';
        contradicts = hits.map((h) => h.path);
      }
    }
    if (status === 'found' && level <= 4 && (q.mustBeExhaustive ?? q.intent === 'exists')) {
      const other = await otherSay(hits);
      if (other.length) {
        status = 'ambiguous';
        contradicts = [...hits.map((h) => h.path), ...other];
      }
    }
    const done: RecallAnswer = {
      status,
      level: status === 'not_found' ? 6 : level,
      hits,
      searched,
      ms: performance.now() - started,
      levelMs,
      ...extra,
      ...(contradicts && { contradicts }),
    };
    if (options.log ?? true) {
      await store.logRecall({
        intent: q.intent,
        status: done.status,
        level: done.level,
        ms: Math.round(done.ms),
        searched,
        found: hits.map((h) => h.path),
      });
    }
    return RecallAnswer.parse(done);
  };

  // A page of the same type that speaks of the same subject and says something else.
  const otherSay = async (hits: readonly Hit[]): Promise<string[]> => {
    const said = new Set(hits.map((h) => h.path));
    const types = new Set(hits.map((h) => h.type));
    const look = about.length ? about : words;
    const rows = look.length ? await store.search(look, undefined, 20) : [];
    const other = rows.filter((r) => {
      if (said.has(r.path) || !types.has(r.type as PageType) || !holds(r.folded, look))
        return false;
      if (!q.field) return true;
      const value = (r.facts as Record<string, unknown>)[q.field];
      return filled(value) && !hits.some((h) => JSON.stringify(h.value) === JSON.stringify(value));
    });
    searched.push({ level: 4, what: `contradiction: ${look.join(' ')}`, found: other.length });
    return other.map((r) => r.path);
  };

  // 1 — a page by its key.
  const keys = q.subject ? [keyString(q.subject.by, q.subject.value)] : keysIn(q.question);
  const subjects = keys.length ? await store.byKeys(keys) : [];
  searched.push({ level: 1, what: keys.slice(0, 8).join(', '), found: subjects.length });
  const first = answers(subjects);
  if (first.length) return settle(1, first);

  // 2 — the pages one, then two links away.
  if (subjects.length) {
    const seen = new Set(subjects.map((s) => s.path));
    let frontier = [...seen];
    for (const step of [1, 2]) {
      const near = (await store.neighbours(frontier, q.via)).filter((p) => !seen.has(p));
      for (const p of near) seen.add(p);
      const hits = answers(await store.pages(near));
      searched.push({
        level: 2,
        what: `${step} lien(s): ${(q.via ?? []).join(', ') || '*'}`,
        found: near.length,
      });
      if (hits.length) return settle(2, hits);
      if (!near.length) break;
      frontier = near;
    }
  }

  // 3, 4 — full-text in the section the answer lives in, then everywhere.
  const home: Section | undefined =
    q.section ??
    (q.type ? TYPE_SECTION[q.type] : subjects[0] ? sectionOf(subjects[0].path) : undefined);
  if (words.length && checkable) {
    if (home) {
      const rows = await store.search(words, home, 20);
      const hits = answers(rows, true);
      searched.push({ level: 3, what: `${home}: ${words.join(' ')}`, found: rows.length });
      if (hits.length) return settle(3, hits);
    }
    const rows = await store.search(words, undefined, 20);
    const hits = answers(rows, true);
    searched.push({ level: 4, what: words.join(' '), found: rows.length });
    if (hits.length) {
      return settle(4, hits, { misplaced: hits.some((h) => sectionOf(h.path) !== home) });
    }

    // 5 — the texts of the originals.
    const raws = await store.searchRaw(words, 5);
    searched.push({ level: 5, what: words.join(' '), found: raws.length });
    for (const raw of raws) {
      if (!holds(fold(raw.body), about)) continue;
      const line = match.length ? lineOf(raw.body, match) : lineOf(raw.body, words, true);
      if (!line) continue;
      const own = subjects.length === 1 ? subjects : await store.citing(raw.ref);
      const page = own.length === 1 ? own[0] : undefined;
      const name = raw.ref.slice(raw.ref.lastIndexOf('/') + 1);
      return settle(5, [{ path: raw.ref, title: name, type: 'raw', sources: [raw.ref], line }], {
        writeback: { path: page?.path ?? null, ref: raw.ref, line },
      });
    }
  }

  // 6 — nothing.
  return settle(6, []);
}
