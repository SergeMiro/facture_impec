// The vault's files as compile, rebuild and a person's edits read them, and what each write adds
// around its pages: the section indexes, the root index, a log line, the open questions and what
// was last written or read of each page (`_system/written.json`: its hash, whether a person wrote
// in it and when). A page that differs from its hash was edited by a person and not read yet.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addQuestions,
  emptyLog,
  endLine,
  indexLine,
  LOG,
  type LogReason,
  lineTarget,
  logLine,
  QUESTIONS,
  type Question,
  ROOT_INDEX,
  readIndexLines,
  renderRootIndex,
  renderSectionIndex,
  sectionIndex,
} from './indexes';
import { type FileContent, SYSTEM_DIR } from './journal';
import { type Page, readPage } from './page';
import { type Backlink, SECTIONS, type Section, sectionOf } from './types';

export const WRITTEN = `${SYSTEM_DIR}/written.json`;

/** A person's edit this recent is never overwritten by an agent's patch (memory doc §5). */
export const HUMAN_WINDOW_MS = 60_000;

/** What the vault last wrote or read of a page. */
export interface Written {
  sha: string;
  /** A person wrote in its text: an agent may add to it, never replace it. */
  person?: true;
  /** When a person last edited it (ISO), as the file's time said when it was read. */
  edited?: string;
}

/** Who a page's file is from, now. */
export interface Authorship {
  /** A person wrote in it, or it differs from what the vault last wrote. */
  person: boolean;
  /** Changed since the vault last wrote or read it. */
  unread: boolean;
  /** Edited by a person within `HUMAN_WINDOW_MS`. */
  recent: boolean;
}

export const fileOf = (path: string) => `${path}.md`;
/** A page's file: in a section, not its index. */
export const isPageFile = (file: string) =>
  /^[a-z]+\/.+\.md$/.test(file) &&
  !/^[a-z]+\/index\.md$/.test(file) &&
  SECTIONS.includes(file.split('/')[0] as Section);
export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export const sortBacklinks = (links: Backlink[]) =>
  links.sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));

export interface Loaded {
  /** The file's text, null when there is none. */
  file: string | null;
  /** The page, null when there is no file or it cannot be read (`reason` says why). */
  page: Page | null;
  reason?: string;
}

export class VaultFiles {
  readonly #loaded = new Map<string, Loaded>();
  #written: Record<string, Written> | null = null;

  constructor(
    readonly root: string,
    readonly now: Date,
  ) {}

  async text(file: string): Promise<string | null> {
    try {
      return await readFile(join(this.root, file), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async bytes(file: string): Promise<Uint8Array | null> {
    try {
      return await readFile(join(this.root, file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async exists(file: string): Promise<boolean> {
    try {
      await stat(join(this.root, file));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }

  async load(path: string): Promise<Loaded> {
    const known = this.#loaded.get(path);
    if (known) return known;
    const file = await this.text(fileOf(path));
    let loaded: Loaded = { file, page: null };
    if (file !== null) {
      const read = readPage(path, file);
      loaded = read.ok ? { file, page: read.page } : { file, page: null, reason: read.reason };
    }
    this.#loaded.set(path, loaded);
    return loaded;
  }

  async written(): Promise<Record<string, Written>> {
    if (!this.#written) {
      const text = await this.text(WRITTEN);
      this.#written = text ? (JSON.parse(text) as Record<string, Written>) : {};
    }
    return this.#written;
  }

  /** A page compile never wrote (made by hand) is a person's. */
  async authorship(path: string): Promise<Authorship> {
    const { file } = await this.load(path);
    if (file === null) return { person: false, unread: false, recent: false };
    const entry = (await this.written())[fileOf(path)];
    const unread = entry?.sha !== sha(file);
    const edited = unread ? await this.mtime(fileOf(path)) : Date.parse(entry?.edited ?? '');
    return {
      person: unread || entry?.person === true,
      unread,
      recent: this.now.getTime() - edited < HUMAN_WINDOW_MS,
    };
  }

  async mtime(file: string): Promise<number> {
    return (await stat(join(this.root, file))).mtimeMs;
  }
}

export interface Change {
  /** Pages whose index line is new or changed. */
  indexed: readonly Page[];
  /** Pages whose index line goes (deleted, or unreadable). */
  unindexed?: readonly string[];
  log: { reason: LogReason; actor: string; pages: readonly string[]; note?: string | undefined };
  questions: readonly Question[];
  /** Section indexes rewritten whole (rebuild), instead of line by line. */
  sections?: Readonly<Record<Section, readonly string[]>>;
  /**
   * Page files whose entry in `written.json` says a person wrote in them: those in `out` the vault
   * rewrote around a person's text, and those it read without rewriting (`content`, then `edited`).
   */
  people?: ReadonlyMap<string, { content?: string; edited?: string }>;
}

/**
 * Adds to `out` what follows a write of pages: the indexes of their sections, the root index, the
 * log line, the questions and the hashes of the pages in `out`.
 */
export async function finish(
  vault: VaultFiles,
  out: Map<string, FileContent>,
  change: Change,
): Promise<void> {
  const counts = {} as Record<Section, number>;
  for (const section of SECTIONS) {
    const file = sectionIndex(section);
    const old = await vault.text(file);
    let lines = change.sections?.[section];
    if (!lines) {
      const mine = change.indexed.filter((p) => sectionOf(p.path) === section);
      const gone = (change.unindexed ?? []).filter((p) => sectionOf(p) === section);
      const current = readIndexLines(old ?? '');
      if (mine.length || gone.length) {
        const byPath = new Map(current.map((l) => [lineTarget(l), l]));
        for (const p of gone) byPath.delete(p);
        for (const p of mine) byPath.set(p.path, indexLine(p));
        lines = [...byPath.values()];
      } else {
        lines = current;
      }
    }
    const rendered = renderSectionIndex(section, lines);
    if (rendered !== old) out.set(file, rendered);
    counts[section] = lines.length;
  }
  const rootIndex = renderRootIndex(counts);
  if ((await vault.text(ROOT_INDEX)) !== rootIndex) out.set(ROOT_INDEX, rootIndex);
  const log = (await vault.text(LOG)) ?? emptyLog();
  out.set(LOG, `${endLine(log)}${logLine({ at: vault.now, ...change.log })}\n`);
  if (change.questions.length) {
    out.set(QUESTIONS, addQuestions(await vault.text(QUESTIONS), change.questions));
  }
  const written = { ...(await vault.written()) };
  for (const [file, content] of out) {
    if (typeof content !== 'string' || !isPageFile(file)) continue;
    const before = written[file];
    const person = change.people?.get(file);
    written[file] = {
      sha: sha(content),
      ...((before?.person || person) && { person: true }),
      ...((person?.edited ?? before?.edited) && { edited: person?.edited ?? before?.edited }),
    };
  }
  for (const [file, person] of change.people ?? []) {
    if (out.has(file) || person.content === undefined) continue;
    written[file] = {
      sha: sha(person.content),
      person: true,
      ...(person.edited && { edited: person.edited }),
    };
  }
  for (const p of change.unindexed ?? []) delete written[fileOf(p)];
  const sorted = Object.fromEntries(Object.entries(written).sort(([a], [b]) => a.localeCompare(b)));
  out.set(WRITTEN, `${JSON.stringify(sorted, null, 1)}\n`);
}
