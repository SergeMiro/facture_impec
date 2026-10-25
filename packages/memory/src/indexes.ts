// The files code writes around the pages (memory doc §3): each section's `index.md` (one line per
// page: name, type, one fact, last update), the root `index.md` (the sections and their size),
// `log.md` (one line per write, append only), `open-questions.md` and `_schema.md`. A line of an
// index starts with its page's link, so an index can be updated a few lines at a time.
import { frDate, frMoney } from '@fi/core';
import { t } from '@fi/shared';
import type { Page } from './page';
import {
  type Frontmatter,
  MEMORY_SCHEMA_VERSION,
  type PageType,
  SECTIONS,
  type Section,
  TYPE_SCHEMAS,
  TYPE_SECTION,
} from './types';

export const ROOT_INDEX = 'index.md';
export const LOG = 'log.md';
export const QUESTIONS = 'open-questions.md';
export const SCHEMA = '_schema.md';
export const sectionIndex = (section: Section) => `${section}/index.md`;

/** The files code owns: never read as pages. */
export const isGenerated = (file: string) =>
  file === ROOT_INDEX ||
  file === LOG ||
  file === QUESTIONS ||
  file === SCHEMA ||
  /^[a-z]+\/index\.md$/.test(file);

const money = (cents: number) => frMoney(cents, 'EUR');

/** The one fact an index shows of a page. */
export function factOf(fm: Frontmatter): string {
  switch (fm.type) {
    case 'tiers':
      return fm.siren ? t('memory.fact.tiers', { siren: fm.siren }) : t('memory.fact.tiersNoSiren');
    case 'chantier':
      return t(`memory.fact.chantier.${fm.status}`);
    case 'facture_vente':
    case 'facture_achat':
    case 'avoir':
      if (fm.paid_at)
        return t('memory.fact.invoicePaid', { ttc: money(fm.ttc), paid: frDate(fm.paid_at) });
      return fm.due_date
        ? t('memory.fact.invoice', { ttc: money(fm.ttc), due: frDate(fm.due_date) })
        : t('memory.fact.invoiceNoDue', { ttc: money(fm.ttc) });
    case 'situation':
      return t('memory.fact.situation', { number: fm.number, cumul: money(fm.cumul_ht) });
    case 'devis':
      return t(`memory.fact.devis.${fm.status}`);
    case 'commande':
      return t('memory.fact.commande', { date: frDate(fm.date) });
    case 'article':
      return fm.last_price === undefined
        ? t('memory.fact.articleNoPrice')
        : t('memory.fact.article', { price: money(fm.last_price) });
    case 'attestation_vigilance':
    case 'kbis':
    case 'attestation_assurance_decennale':
    case 'attestation_assurance_rc':
      return t('memory.fact.standing', { date: frDate(fm.valid_to) });
    case 'salarie':
      return t('memory.fact.salarie', { date: frDate(fm.start) });
    case 'document':
      return fm.date
        ? t('memory.fact.document', { date: frDate(fm.date) })
        : t('memory.fact.documentNoDate');
  }
}

export function indexLine(page: Page): string {
  const fm = page.frontmatter;
  return `- ${t('memory.index.line', {
    path: page.path,
    title: fm.title.replace(/[[\]|]/g, ' '),
    type: t(`memory.type.${fm.type}`),
    fact: factOf(fm),
    updated: frDate(fm.updated),
  })}`;
}

/** The page a line of an index is about. */
export const lineTarget = (line: string) => /^- \[\[([^|\]]+)/.exec(line)?.[1];

/** A section's index from its lines, sorted by page. */
export function renderSectionIndex(section: Section, lines: Iterable<string>): string {
  const sorted = [...lines].sort((a, b) =>
    (lineTarget(a) ?? '').localeCompare(lineTarget(b) ?? ''),
  );
  return [
    `# ${t(`memory.section.${section}`)}`,
    '',
    `${capitalise(t(`memory.section.about.${section}`))}.`,
    '',
    ...sorted,
    '',
  ].join('\n');
}

/** The lines of a section's index file. */
export const readIndexLines = (file: string) =>
  file.split('\n').filter((l) => lineTarget(l) !== undefined);

export function renderRootIndex(counts: Readonly<Record<Section, number>>): string {
  const app = t('app.title');
  return [
    `# ${t('memory.root.title')}`,
    '',
    t('memory.root.intro', { app }),
    '',
    ...SECTIONS.map(
      (s) =>
        `- ${t('memory.root.line', {
          section: s,
          name: t(`memory.section.${s}`),
          about: t(`memory.section.about.${s}`),
          count: counts[s],
        })}`,
    ),
    '',
    t('memory.root.files'),
    '',
  ].join('\n');
}

/** « 2026-10-21 14:03 », Paris time: when a person reads the log, it is their clock. */
export function parisMinute(at: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

export type LogReason =
  | 'ingest'
  | 'query_writeback'
  | 'query'
  | 'relink'
  | 'link_review'
  | 'lint'
  | 'user_edit'
  | 'action_result'
  | 'rebuild';

export function logLine(entry: {
  at: Date;
  reason: LogReason;
  actor: string;
  pages: readonly string[];
  note?: string | undefined;
}): string {
  const params = {
    at: parisMinute(entry.at),
    reason: t(`memory.reason.${entry.reason}`),
    actor: entry.actor,
    pages: entry.pages.join(', ') || '—',
  };
  return `- ${
    entry.note
      ? t('memory.log.lineNote', { ...params, note: entry.note.replace(/\s+/g, ' ') })
      : t('memory.log.line', params)
  }`;
}

export const emptyLog = () =>
  [`# ${t('memory.log.title')}`, '', t('memory.log.intro'), '', ''].join('\n');

export interface Question {
  date: string;
  /** The page it is about, or none (the memory as a whole). */
  entity?: string | undefined;
  text: string;
  /** It stops an action until a person answers. */
  blocking?: boolean | undefined;
}

export function questionLine(q: Question): string {
  const params = {
    date: frDate(q.date),
    entity: q.entity ? `[[${q.entity}]]` : t('memory.question.noEntity'),
    text: q.text.replace(/\s+/g, ' '),
  };
  return `- [ ] ${t(q.blocking ? 'memory.question.blocking' : 'memory.question.line', params)}`;
}

export const emptyQuestions = () =>
  [
    `# ${t('memory.questions.title')}`,
    '',
    t('memory.questions.intro', { app: t('app.title') }),
    '',
    '',
  ].join('\n');

/**
 * The questions file with `questions` added at its end, each unless the same one (same entity, same
 * text) is still open.
 */
export function addQuestions(file: string | null, questions: readonly Question[]): string {
  let out = file ?? emptyQuestions();
  for (const q of questions) {
    const open = questionLine(q).slice('- [ ] '.length).split(' · ').slice(1).join(' · ');
    const already = out
      .split('\n')
      .some((l) => l.startsWith('- [ ] ') && l.split(' · ').slice(1).join(' · ') === open);
    if (!already) out = `${endLine(out)}${questionLine(q)}\n`;
  }
  return out;
}

/** `_schema.md`: the version, then each type's folder and fields, from the Zod schemas. */
export function renderSchema(): string {
  const rows = (Object.keys(TYPE_SCHEMAS) as PageType[]).map((type) => {
    const shape = TYPE_SCHEMAS[type].shape as Record<
      string,
      { safeParse(v: unknown): { success: boolean } }
    >;
    const fields = Object.keys(shape).filter((f) => f !== 'type');
    const optional = fields.filter((f) => shape[f]?.safeParse(undefined).success);
    const required = fields.filter((f) => !optional.includes(f));
    return t('memory.schema.row', {
      type: t(`memory.type.${type}`),
      name: type,
      section: TYPE_SECTION[type],
      required: required.map((f) => `\`${f}\``).join(', '),
      optional: optional.map((f) => `\`${f}\``).join(', '),
    });
  });
  return [
    `# ${t('memory.schema.title', { version: MEMORY_SCHEMA_VERSION })}`,
    '',
    t('memory.schema.intro', { app: t('app.title') }),
    '',
    t('memory.schema.header'),
    '|---|---|---|---|',
    ...rows,
    '',
    `<!-- memory-schema-version: ${MEMORY_SCHEMA_VERSION} -->`,
    '',
  ].join('\n');
}

/** The version a vault's `_schema.md` declares, null when it has none. */
export function schemaVersionOf(file: string): number | null {
  const m = /<!-- memory-schema-version: (\d+) -->/.exec(file);
  return m ? Number(m[1]) : null;
}

/** `text` ending with a line break, its blank lines kept. */
export const endLine = (text: string) => (text.endsWith('\n') ? text : `${text}\n`);

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
