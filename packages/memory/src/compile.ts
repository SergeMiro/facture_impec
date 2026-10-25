// Every change to the memory goes through compile (memory doc §5): a patch of pages is checked
// (each frontmatter against its type, its folder, its sources, its links' targets), the links are
// written both ways, the section and root indexes, the log and the open questions follow, and all of
// it lands as one write (journal.ts). Nothing else writes a page. A person's edit wins: a patch that
// would overwrite a page a person changed in the last minute, or replace a text a person wrote, is
// not written; it becomes an open question.
import { parisToday } from '@fi/core';
import { t } from '@fi/shared';
import type { LogReason, Question } from './indexes';
import { commitFiles, type FileContent, recover } from './journal';
import { encodeFrontmatter, type Page, writePage } from './page';
import { type Frontmatter, type Link, PagePath, sectionOf, TYPE_SECTION } from './types';
import { fileOf, finish, sortBacklinks, VaultFiles } from './vault';

export { HUMAN_WINDOW_MS } from './vault';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A page as a patch gives it: compile sets `updated` and owns `backlinks`. */
export type PageFacts = DistributiveOmit<Frontmatter, 'updated' | 'backlinks'>;

export interface PageWrite {
  path: PagePath;
  frontmatter: PageFacts;
  /** Replaces the page's text: for a new page, or one no person has written in. */
  text?: string;
  /** A paragraph added at the end of the text (a model's summary, with its source). */
  append?: string;
}

export interface MemoryPatch {
  reason: Exclude<LogReason, 'rebuild' | 'user_edit'>;
  /** Who: `agent:<name>`, `user:<id>`, `system`. */
  actor: string;
  pages: readonly PageWrite[];
  /** The end of its log line (a rule's outcome, a document's name). */
  note?: string;
  /** What this write leaves unsure, for a person. */
  questions?: readonly Question[];
}

export interface VaultOptions {
  now: Date;
  /** `rh/` is written only when the company turns it on (memory doc §10). */
  rh?: boolean;
  /** Whether a record a source names exists; a `raw/` file is looked up on disk. */
  sourceExists?: (ref: string) => boolean | Promise<boolean>;
}

export type CompileFailure = 'invalid' | 'section' | 'source' | 'link' | 'conflict';
export type CompileResult =
  | { ok: true; written: string[] }
  | { ok: false; code: CompileFailure; detail: string };

const linkKey = (l: Link) => `${l.kind} ${l.to}`;

/** Applies `patch` to the vault at `root`, all of it or nothing. */
export async function compile(
  root: string,
  patch: MemoryPatch,
  options: VaultOptions,
): Promise<CompileResult> {
  const fail = (code: CompileFailure, detail: string): CompileResult => ({
    ok: false,
    code,
    detail,
  });
  const today = parisToday(options.now);
  // A write a crash cut is finished first: read half done, its pages would look edited by a person.
  await recover(root);
  const vault = new VaultFiles(root, options.now);
  const own = new Set<string>();
  for (const w of patch.pages) {
    if (!PagePath.safeParse(w.path).success) return fail('invalid', `${w.path}: not a page path`);
    if (own.has(w.path)) return fail('invalid', `${w.path}: twice in one patch`);
    own.add(w.path);
    const section = TYPE_SECTION[w.frontmatter.type];
    if (sectionOf(w.path) !== section) {
      return fail('section', `${w.path}: a ${w.frontmatter.type} page lives in ${section}/`);
    }
    if (section === 'rh' && !options.rh) return fail('section', `${w.path}: rh/ is off`);
    try {
      encodeFrontmatter({ ...w.frontmatter, updated: today } as Frontmatter);
    } catch (e) {
      return fail('invalid', `${w.path}: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
    for (const ref of w.frontmatter.sources) {
      const found = ref.startsWith('raw/')
        ? await vault.exists(ref)
        : ((await options.sourceExists?.(ref)) ?? false);
      if (!found) return fail('source', `${w.path}: source ${ref} not found`);
    }
  }

  // The pages as they will be, before backlinks.
  const next = new Map<string, Page>();
  const people = new Map<string, { edited?: string }>();
  for (const w of patch.pages) {
    const old = await vault.load(w.path);
    if (old.file !== null && !old.page) {
      return conflict(vault, patch, w.path, `${w.path}: ${old.reason}`);
    }
    const author = await vault.authorship(w.path);
    if (author.recent || (author.person && w.text !== undefined)) {
      return conflict(vault, patch, w.path, `${w.path}: edited by a person`);
    }
    if (author.unread) {
      const edited = new Date(await vault.mtime(fileOf(w.path))).toISOString();
      people.set(fileOf(w.path), { edited });
    }
    const base = w.text ?? old.page?.text ?? '';
    const text = w.append ? [base, w.append.trim()].filter(Boolean).join('\n\n') : base;
    const backlinks = old.page?.frontmatter.backlinks;
    const frontmatter = { ...w.frontmatter, updated: today, ...(backlinks && { backlinks }) };
    next.set(w.path, { path: w.path, frontmatter: frontmatter as Frontmatter, text });
  }

  // Links both ways: what each page's links became, onto its targets' backlinks.
  for (const w of patch.pages) {
    const before = (await vault.load(w.path)).page?.frontmatter.links ?? [];
    const after = w.frontmatter.links ?? [];
    const removed = before.filter((b) => !after.some((a) => linkKey(a) === linkKey(b)));
    const added = after.filter((a) => !before.some((b) => linkKey(a) === linkKey(b)));
    for (const l of [...removed, ...added]) {
      if (l.to === w.path) return fail('link', `${w.path}: links to itself`);
      let target = next.get(l.to);
      if (!target) {
        const loaded = await vault.load(l.to);
        if (!loaded.page) {
          if (removed.includes(l)) continue; // its target is gone: nothing to unlink
          return fail('link', `${w.path}: ${l.kind} to ${l.to}, which is not a page`);
        }
        const author = await vault.authorship(l.to);
        if (author.recent) return conflict(vault, patch, l.to, `${l.to}: edited by a person`);
        if (author.unread) {
          const edited = new Date(await vault.mtime(fileOf(l.to))).toISOString();
          people.set(fileOf(l.to), { edited });
        }
        target = { ...loaded.page };
        next.set(l.to, target);
      }
      const backlinks = (target.frontmatter.backlinks ?? []).filter(
        (b) => !(b.kind === l.kind && b.from === w.path),
      );
      if (added.includes(l)) backlinks.push({ kind: l.kind, from: w.path });
      const { backlinks: _old, ...rest } = target.frontmatter;
      target.frontmatter = {
        ...rest,
        ...(backlinks.length && { backlinks: sortBacklinks(backlinks) }),
      } as Frontmatter;
    }
  }

  // A page whose file would change only by its date is not written again.
  const out = new Map<string, FileContent>();
  const logged: Page[] = [];
  for (const page of next.values()) {
    const file = writePage(page);
    const before = (await vault.load(page.path)).file;
    if (before !== null && sameExceptUpdated(before, file)) continue;
    out.set(fileOf(page.path), file);
    if (own.has(page.path)) logged.push(page);
  }
  if (out.size === 0 && !patch.questions?.length) return { ok: true, written: [] };
  await finish(vault, out, {
    indexed: logged,
    log: {
      reason: patch.reason,
      actor: patch.actor,
      pages: logged.map((p) => p.path),
      note: patch.note,
    },
    questions: patch.questions ?? [],
    people,
  });
  await commitFiles(root, out);
  return { ok: true, written: logged.map((p) => p.path) };
}

/** Two files of one page that differ only by their `updated` line. */
function sameExceptUpdated(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/^updated: .*$/m, '');
  return strip(a) === strip(b);
}

/** The patch is not written; a person is asked to look at the page instead. */
async function conflict(
  vault: VaultFiles,
  patch: MemoryPatch,
  path: string,
  detail: string,
): Promise<CompileResult> {
  const out = new Map<string, FileContent>();
  const question: Question = {
    date: parisToday(vault.now),
    entity: path,
    text: t('memory.question.conflict', {
      app: t('app.title'),
      reason: t(`memory.reason.${patch.reason}`),
    }),
  };
  await finish(vault, out, {
    indexed: [],
    log: { reason: patch.reason, actor: patch.actor, pages: [], note: detail },
    questions: [question],
  });
  await commitFiles(vault.root, out);
  return { ok: false, code: 'conflict', detail };
}
