// Every page read again (memory doc §5 « rebuild »): at start-up, after a restore, or when a person
// asks. The indexes, the root index and `_schema.md` are written from what the pages say; the links
// are read from every page and the backlinks written again where they differ; a page that cannot be
// read stays as it is, out of the index, with an open question; a synchronisation's conflict copy
// goes to `_conflicts/`. A vault written by a newer version of the schema is refused, not rewritten.
import { parisToday } from '@fi/core';
import { t } from '@fi/shared';
import {
  indexLine,
  isGenerated,
  type Question,
  renderSchema,
  SCHEMA,
  schemaVersionOf,
} from './indexes';
import { commitFiles, type FileContent, recover, walk } from './journal';
import { type Page, writePage } from './page';
import {
  type Backlink,
  MEMORY_SCHEMA_VERSION,
  PagePath,
  SECTIONS,
  type Section,
  sectionOf,
  TYPE_SECTION,
} from './types';
import { fileOf, finish, isPageFile, sortBacklinks, VaultFiles } from './vault';

export const CONFLICTS_DIR = '_conflicts';

export class VaultTooNew extends Error {
  constructor(readonly version: number) {
    super(
      `the vault's schema is version ${version}, this one reads up to ${MEMORY_SCHEMA_VERSION}`,
    );
    this.name = 'VaultTooNew';
  }
}

export interface RebuildOptions {
  now: Date;
  actor?: string;
}

export interface RebuildResult {
  pages: number;
  /** Files left out of the index: unreadable, misnamed, in the wrong folder. */
  invalid: string[];
  /** Conflict copies moved to `_conflicts/`. */
  copies: string[];
  /** Pages whose backlinks were written again. */
  relinked: number;
}

/**
 * The name a synchronisation gives a copy of `name` it could not merge: « marc-elec (1) »,
 * « marc-elec (conflicted copy 2026-10-25) », « marc-elec (copie en conflit) ». Which names Drive
 * and OneDrive use exactly is TODO(verify) on a real account (docs/TODO.md › Memory); a misnamed
 * file that matches no page is reported as misnamed instead, so nothing is lost either way.
 */
export function copyOf(name: string): string | null {
  const m = /^(.+?)\s*\((?:\d+|[^)]*(?:conflict|conflit)[^)]*)\)$/i.exec(name);
  return m?.[1] ?? null;
}

export type Classified =
  | { kind: 'page'; page: Page }
  | { kind: 'invalid'; path: string | null; question: Question }
  | { kind: 'copy'; of: string };

/** What a page file of the vault is. */
export async function classify(vault: VaultFiles, file: string): Promise<Classified> {
  const date = parisToday(vault.now);
  const name = file.replace(/\.md$/, '');
  if (!PagePath.safeParse(name).success) {
    const of = copyOf(name);
    if (of && PagePath.safeParse(of).success && (await vault.exists(fileOf(of)))) {
      return { kind: 'copy', of };
    }
    const text = t('memory.question.badName', { file });
    return { kind: 'invalid', path: null, question: { date, text } };
  }
  const loaded = await vault.load(name);
  if (!loaded.page) {
    const text = t('memory.question.invalidPage', { reason: loaded.reason ?? '' });
    return { kind: 'invalid', path: name, question: { date, entity: name, text } };
  }
  const section = TYPE_SECTION[loaded.page.frontmatter.type];
  if (section !== sectionOf(name)) {
    const type = t(`memory.type.${loaded.page.frontmatter.type}`);
    const text = t('memory.question.wrongSection', { type, section });
    return { kind: 'invalid', path: name, question: { date, entity: name, text } };
  }
  return { kind: 'page', page: loaded.page };
}

/** Moves a conflict copy under `_conflicts/<day>/`, where nothing reads it as a page. */
export async function setAside(
  vault: VaultFiles,
  out: Map<string, FileContent>,
  file: string,
  of: string,
): Promise<Question> {
  const date = parisToday(vault.now);
  const copy = `${CONFLICTS_DIR}/${date}/${file}`;
  out.set(copy, (await vault.text(file)) ?? '');
  out.set(file, null);
  return { date, entity: of, text: t('memory.question.conflictCopy', { copy }) };
}

/** Every page file of the vault. */
export async function pageFiles(root: string): Promise<string[]> {
  return (await walk(root)).filter(
    (f) => isPageFile(f) && !isGenerated(f) && !/\.tmp-[0-9a-f]{12}$/.test(f),
  );
}

const sameBacklinks = (a: readonly Backlink[] | undefined, b: readonly Backlink[]) =>
  JSON.stringify(sortBacklinks([...(a ?? [])])) === JSON.stringify(b);

/**
 * The backlinks every page should have, from every page's links; the pages whose backlinks differ,
 * written again unless a person is editing them (they are relinked by the next pass); a question
 * for each link to a page that does not exist.
 */
export async function relink(
  vault: VaultFiles,
  pages: ReadonlyMap<string, Page>,
  out: Map<string, FileContent>,
  people: Map<string, { content?: string; edited?: string }>,
): Promise<{ relinked: number; questions: Question[] }> {
  const date = parisToday(vault.now);
  const expected = new Map<string, Backlink[]>();
  const questions: Question[] = [];
  for (const page of pages.values()) {
    for (const l of page.frontmatter.links ?? []) {
      if (!pages.has(l.to)) {
        const text = t('memory.question.missingTarget', { target: l.to });
        questions.push({ date, entity: page.path, text });
        continue;
      }
      const list = expected.get(l.to) ?? [];
      list.push({ kind: l.kind, from: page.path });
      expected.set(l.to, list);
    }
  }
  let relinked = 0;
  for (const page of pages.values()) {
    const backlinks = sortBacklinks(expected.get(page.path) ?? []);
    if (sameBacklinks(page.frontmatter.backlinks, backlinks)) continue;
    const author = await vault.authorship(page.path);
    if (author.recent) continue;
    const { backlinks: _old, ...rest } = page.frontmatter;
    const frontmatter = { ...rest, ...(backlinks.length && { backlinks }) } as Page['frontmatter'];
    out.set(fileOf(page.path), writePage({ ...page, frontmatter }));
    if (author.unread) {
      const edited = new Date(await vault.mtime(fileOf(page.path))).toISOString();
      people.set(fileOf(page.path), { edited });
    }
    relinked++;
  }
  return { relinked, questions };
}

/** Every page read again, the indexes and backlinks written from them. */
export async function rebuild(root: string, options: RebuildOptions): Promise<RebuildResult> {
  await recover(root, true);
  const vault = new VaultFiles(root, options.now);
  const schema = await vault.text(SCHEMA);
  const version = schema === null ? null : schemaVersionOf(schema);
  if (version !== null && version > MEMORY_SCHEMA_VERSION) throw new VaultTooNew(version);

  const out = new Map<string, FileContent>();
  const pages = new Map<string, Page>();
  const questions: Question[] = [];
  const invalid: string[] = [];
  const copies: string[] = [];
  for (const file of await pageFiles(root)) {
    const found = await classify(vault, file);
    if (found.kind === 'page') pages.set(found.page.path, found.page);
    else if (found.kind === 'copy') {
      questions.push(await setAside(vault, out, file, found.of));
      copies.push(file);
    } else {
      questions.push(found.question);
      invalid.push(file);
    }
  }

  const people = new Map<string, { content?: string; edited?: string }>();
  const linked = await relink(vault, pages, out, people);
  questions.push(...linked.questions);
  // A person's edits not read yet are read now: the vault takes them as theirs.
  for (const page of pages.values()) {
    const file = fileOf(page.path);
    if (out.has(file)) continue;
    const author = await vault.authorship(page.path);
    if (!author.unread) continue;
    const content = (await vault.text(file)) ?? '';
    people.set(file, { content, edited: new Date(await vault.mtime(file)).toISOString() });
  }

  const sections = Object.fromEntries(SECTIONS.map((s) => [s, [] as string[]])) as Record<
    Section,
    string[]
  >;
  for (const page of pages.values()) sections[sectionOf(page.path)].push(indexLine(page));
  const gone = Object.keys(await vault.written())
    .map((f) => f.replace(/\.md$/, ''))
    .filter((p) => !pages.has(p));
  const rendered = renderSchema();
  if (schema !== rendered) out.set(SCHEMA, rendered);

  await finish(vault, out, {
    indexed: [],
    unindexed: gone,
    sections,
    log: {
      reason: 'rebuild',
      actor: options.actor ?? 'system',
      pages: [],
      note: t('memory.log.rebuildNote', {
        pages: pages.size,
        invalid: invalid.length,
        relinked: linked.relinked,
      }),
    },
    questions,
    people,
  });
  await commitFiles(root, out);
  return { pages: pages.size, invalid, copies, relinked: linked.relinked };
}
