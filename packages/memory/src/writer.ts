// The vault as its one writer holds it (memory doc §6): the lock taken and renewed, the vault read
// again at opening, then every write (an agent's patch, a person's edits, a rebuild) one after the
// other, never two at once, each followed by the index in the database when there is one (M1).
// Every page written gets its links from the rules (link-rules.ts), and the pages that were waiting
// for it get theirs again (M2). Recall reads the index; what it finds in `raw/` is written back onto
// its page, and what it does not find, or finds twice, becomes an open question. The runner (M3)
// opens it once and keeps it.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frDate, parisToday } from '@fi/core';
import { t } from '@fi/shared';
import {
  type CompileResult,
  compile,
  type MemoryPatch,
  type PageFacts,
  type PageWrite,
  type VaultOptions,
} from './compile';
import { countQuestions, QUESTIONS, sectionIndex } from './indexes';
import { walk } from './journal';
import { keepWord, type Linkable, LinkIndex, linksOf, sameLinks, withLinks } from './link-rules';
import { type LintInput, lintMemory, type MemoryFinding } from './lint';
import { acquireLock, LOCK_TTL_MS, type LockFile, releaseLock, renewLock } from './lock';
import type { Page } from './page';
import { addRaw, type RawFile, readRawTexts } from './raw';
import { classify, pageFiles, rebuild } from './rebuild';
import { type RecallAnswer, type RecallQuery, recall } from './recall';
import type { MemoryStore } from './store';
import { type LinkKind, SECTIONS, type Section } from './types';
import { VaultFiles } from './vault';
import { applyUserEdits, watchVault } from './watch';

export interface MemoryVaultOptions extends Omit<VaultOptions, 'now'> {
  host: string;
  pid?: number;
  clock?: () => Date;
  ttlMs?: number;
  /** The index recall reads; kept in step with every write. */
  store?: MemoryStore;
}

const RECALL_ACTOR = 'agent:recall';
const LINT_ACTOR = 'agent:lint';
const SYSTEM_ACTOR = 'system';

const pathOf = (file: string) => file.replace(/\.md$/, '');

/** A page's facts as a patch gives them: without the date and the backlinks compile writes. */
function factsOf(page: Linkable): PageFacts {
  const { updated: _u, backlinks: _b, ...facts } = page.frontmatter as Page['frontmatter'];
  return facts as PageFacts;
}

export class MemoryVault {
  #queue: Promise<unknown> = Promise.resolve();
  #lock: LockFile;
  #lost: Error | null = null;
  #renew: NodeJS.Timeout;
  #stopWatch: (() => void) | null = null;
  /** Every page as last written, for the link rules. */
  #links = new LinkIndex();

  private constructor(
    readonly root: string,
    readonly options: MemoryVaultOptions,
    lock: LockFile,
  ) {
    this.#lock = lock;
    const ttlMs = options.ttlMs ?? LOCK_TTL_MS;
    this.#renew = setInterval(() => {
      renewLock(root, this.#lock, this.#holder()).then(
        (l) => {
          this.#lock = l;
        },
        (e: Error) => {
          this.#lost = e;
        },
      );
    }, ttlMs / 3);
    this.#renew.unref();
  }

  /** Takes the vault (`VaultLocked` when another runner holds it) and reads it again. */
  static async open(root: string, options: MemoryVaultOptions): Promise<MemoryVault> {
    const now = options.clock?.() ?? new Date();
    const lock = await acquireLock(root, {
      host: options.host,
      pid: options.pid ?? process.pid,
      now,
      ...(options.ttlMs && { ttlMs: options.ttlMs }),
    });
    const vault = new MemoryVault(root, options, lock);
    try {
      await vault.rebuild();
    } catch (e) {
      await vault.close();
      throw e;
    }
    return vault;
  }

  #now = () => this.options.clock?.() ?? new Date();

  #holder() {
    return {
      host: this.options.host,
      pid: this.options.pid ?? process.pid,
      now: this.#now(),
      ...(this.options.ttlMs && { ttlMs: this.options.ttlMs }),
    };
  }

  /** Runs `write` after every write before it; refuses once the lock was lost. */
  #serial<T>(write: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(() => {
      if (this.#lost) throw this.#lost;
      return write();
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #compile(patch: MemoryPatch) {
    const { rh, sourceExists } = this.options;
    return compile(this.root, patch, {
      now: this.#now(),
      ...(rh !== undefined && { rh }),
      ...(sourceExists && { sourceExists }),
    });
  }

  /** The pages at `paths` as their files say now, those that are pages. */
  async #pages(paths: readonly string[]): Promise<Page[]> {
    const vault = new VaultFiles(this.root, this.#now());
    const pages: Page[] = [];
    for (const path of paths) {
      const c = await classify(vault, `${path}.md`);
      if (c.kind === 'page') pages.push(c.page);
    }
    return pages;
  }

  /** The pages at `paths` read again into the link index and the store. */
  async #took(paths: readonly string[]): Promise<void> {
    const pages = await this.#pages(paths);
    for (const p of pages) this.#links.put(p);
    await this.options.store?.upsert(pages);
  }

  /** A patch with the rules' links on its pages, then the pages that were waiting for them. */
  async #write(patch: MemoryPatch): Promise<CompileResult> {
    const index = this.#links;
    const before = patch.pages.flatMap((w) => index.get(w.path) ?? []);
    // The pages as they will read, so that the patch's pages find each other.
    for (const w of patch.pages) {
      const was = index.get(w.path);
      const text = [w.text ?? was?.text ?? '', w.append?.trim()].filter(Boolean).join('\n\n');
      index.put({ path: w.path, frontmatter: keepWord(w.frontmatter, was), text });
    }
    const pages = patch.pages.map((w) => {
      const page = index.get(w.path) as Linkable;
      return { ...w, frontmatter: withLinks(page.frontmatter, linksOf(page, index)) };
    });
    for (const w of patch.pages) index.remove(w.path);
    for (const p of before) index.put(p);
    const done = await this.#compile({ ...patch, pages });
    if (!done.ok) return done;
    await this.#took(done.written);
    const after = done.written.flatMap((p) => index.get(p) ?? []);
    await this.#relink(index.dependents([...before, ...after]));
    return done;
  }

  /**
   * The rules again on `paths`, and those whose links changed written. Rules read facts, never
   * links, so the pages written here make no other page wait.
   */
  async #relink(paths: Iterable<string>): Promise<void> {
    const pages: PageWrite[] = [];
    for (const path of paths) {
      const page = this.#links.get(path);
      if (!page) continue;
      const links = linksOf(page, this.#links);
      if (sameLinks(links, page.frontmatter.links ?? [])) continue;
      pages.push({ path, frontmatter: withLinks(factsOf(page), links) });
    }
    if (!pages.length) return;
    // Refused when a person is editing one of them: the next write, or the next opening, tries again.
    const done = await this.#compile({ reason: 'relink', actor: SYSTEM_ACTOR, pages });
    if (done.ok) await this.#took(done.written);
  }

  compile(patch: MemoryPatch) {
    return this.#serial(() => this.#write(patch));
  }

  rebuild() {
    return this.#serial(async () => {
      const done = await rebuild(this.root, { now: this.#now() });
      const invalid = new Set(done.invalid);
      const files = (await pageFiles(this.root)).filter((f) => !invalid.has(f));
      this.#links = new LinkIndex(await this.#pages(files.map(pathOf)));
      await this.#relink([...this.#links.values()].map((p) => p.path));
      // Every page of the index was read from its file, the relinked ones again.
      const pages = [...this.#links.values()] as Page[];
      await this.options.store?.replace(pages, await readRawTexts(this.root));
      return done;
    });
  }

  userEdits(files: readonly string[]) {
    return this.#serial(async () => {
      const done = await applyUserEdits(this.root, files, { now: this.#now() });
      const gone = [...done.removed, ...done.invalid.map(pathOf)];
      const before = [...done.accepted, ...gone].flatMap((p) => this.#links.get(p) ?? []);
      const accepted = await this.#pages(done.accepted);
      for (const p of accepted) this.#links.put(p);
      for (const p of gone) this.#links.remove(p);
      const { store } = this.options;
      if (store) {
        await store.upsert(accepted);
        await store.remove(gone);
      }
      // The pages a person edited keep their links until the next write: one written in the minute
      // after a person's edit would be refused (compile.ts).
      await this.#relink(this.#links.dependents([...before, ...accepted]));
      return done;
    });
  }

  /**
   * A person's word on one of a page's links: confirmed (an inferred link becomes strong, and no
   * rule takes it back), or refused (gone, and no rule makes it again).
   */
  reviewLink(
    path: string,
    link: { kind: LinkKind; to: string },
    verdict: 'confirm' | 'refuse',
    actor: string,
  ): Promise<CompileResult> {
    if (!actor.startsWith('user:')) throw new Error('only a person confirms or refuses a link');
    return this.#serial(async () => {
      const [page] = await this.#pages([path]);
      const links = page?.frontmatter.links ?? [];
      const target = links.find((l) => l.kind === link.kind && l.to === link.to);
      if (!page || !target) {
        return { ok: false, code: 'link', detail: `${path}: no ${link.kind} link to ${link.to}` };
      }
      const facts = factsOf(page);
      const by = t('memory.evidence.confirmed', {
        who: actor,
        date: frDate(parisToday(this.#now())),
      });
      const frontmatter =
        verdict === 'confirm'
          ? withLinks(
              facts,
              links.map((l) =>
                l === target
                  ? {
                      ...l,
                      confidence: l.confidence === 'inferred' ? 'strong' : l.confidence,
                      confirmed_by: by,
                    }
                  : l,
              ),
            )
          : ({
              ...withLinks(
                facts,
                links.filter((l) => l !== target),
              ),
              refused_links: [...(facts.refused_links ?? []), link],
            } as PageFacts);
      return this.#write({
        reason: 'link_review',
        actor,
        pages: [{ path, frontmatter }],
        note: `${link.kind} ${link.to}`,
      });
    });
  }

  /**
   * What is wrong with the memory, as the files say now (lint.ts); `known` adds what only the
   * database knows (the deadlines followed, what recall found).
   */
  lint(known: Pick<LintInput, 'deadlines' | 'recalls'> = {}): Promise<MemoryFinding[]> {
    return this.#serial(async () => {
      const files = await pageFiles(this.root);
      const pages = await this.#pages(files.map(pathOf));
      const indexes = {} as Record<Section, string | null>;
      for (const section of SECTIONS) {
        indexes[section] = await readFile(join(this.root, sectionIndex(section)), 'utf8').catch(
          () => null,
        );
      }
      const raw = new Set(await walk(this.root, join(this.root, 'raw')));
      const today = parisToday(this.#now());
      return lintMemory({ pages, indexes, raw, today, ...known });
    });
  }

  /**
   * A finding a person approved, mended: the vault rebuilt, a page's links made again, a link to
   * nothing dropped. A question is asked instead. False when there was nothing left to mend.
   */
  async fix(finding: MemoryFinding, actor: string): Promise<boolean> {
    if (!actor.startsWith('user:')) throw new Error('only a person approves a fix of the memory');
    switch (finding.fix) {
      case 'reindex':
        await this.rebuild();
        return true;
      case 'relink':
        return this.#serial(async () => {
          if (!this.#links.get(finding.page)) return false;
          await this.#relink([finding.page]);
          return true;
        });
      case 'drop_link':
        return this.#serial(async () => {
          const [page] = await this.#pages([finding.page]);
          const links = page?.frontmatter.links ?? [];
          const { link } = finding;
          const kept = links.filter((l) => !(l.kind === link?.kind && l.to === link.to));
          if (!page || kept.length === links.length) return false;
          const done = await this.#write({
            reason: 'lint',
            actor,
            pages: [{ path: page.path, frontmatter: withLinks(factsOf(page), kept) }],
            note: finding.detail,
          });
          return done.ok;
        });
      case 'question':
        await this.ask([finding]);
        return true;
    }
  }

  /** Lint's questions in `open-questions.md`, each once while it stays open. */
  ask(findings: readonly MemoryFinding[]): Promise<CompileResult> {
    const date = parisToday(this.#now());
    const questions = findings.map((f) => ({
      date,
      entity: f.page.endsWith('.md') ? undefined : f.page,
      text: f.text,
    }));
    return this.#serial(() =>
      this.#compile({ reason: 'lint', actor: LINT_ACTOR, pages: [], questions }),
    );
  }

  /** How many questions `open-questions.md` holds open, and how many block an action. */
  async questions(): Promise<{ open: number; blocking: number }> {
    return countQuestions(await readFile(join(this.root, QUESTIONS), 'utf8').catch(() => null));
  }

  /** Keeps an original in `raw/`, its text in the index. */
  addRaw(file: RawFile) {
    return this.#serial(async () => {
      const ref = await addRaw(this.root, file, this.#now());
      if (file.text !== undefined) await this.options.store?.addRaw({ ref, text: file.text });
      return ref;
    });
  }

  /**
   * Searches the memory; writes back what was found in `raw/` onto its page and asks a person about
   * what was not found, or found twice. Needs the index (`store`).
   */
  async recall(query: RecallQuery): Promise<RecallAnswer> {
    const { store } = this.options;
    if (!store) throw new Error('recall needs the index: open the vault with a store');
    const answer = await recall(store, query);
    const date = parisToday(this.#now());
    const asked = query.question;
    if (answer.writeback?.path) {
      const { path, ref, line } = answer.writeback;
      answer.writeback.written = await this.#serial(async () => {
        const [page] = await this.#pages([path]);
        if (!page) return false;
        const facts = factsOf(page);
        const sources = [...new Set([...facts.sources, ref])];
        const done = await this.#write({
          reason: 'query_writeback',
          actor: RECALL_ACTOR,
          pages: [
            {
              path,
              frontmatter: { ...facts, sources } as PageFacts,
              append: t('memory.recall.writeback', { line, ref, question: asked }),
            },
          ],
          note: asked,
        });
        return done.ok;
      });
    } else if (answer.writeback) {
      const text = t('memory.question.unfiled', { ref: answer.writeback.ref, question: asked });
      await this.#ask({ date, text });
    } else if (answer.status === 'not_found') {
      await this.#ask({
        date,
        text: t('memory.question.notFound', { app: t('app.title'), question: asked }),
      });
    } else if (answer.status === 'ambiguous') {
      const pages = (answer.contradicts ?? []).map((p) => `[[${p}]]`).join(', ');
      await this.#ask({
        date,
        entity: answer.hits[0]?.path,
        text: t('memory.question.contradiction', { question: asked, pages }),
        blocking: true,
      });
    }
    return answer;
  }

  #ask(question: { date: string; entity?: string | undefined; text: string; blocking?: boolean }) {
    return this.#serial(() =>
      this.#compile({ reason: 'query', actor: RECALL_ACTOR, pages: [], questions: [question] }),
    );
  }

  /** Reads a person's edits as they are saved; `onError` hears what could not be read. */
  watch(onError: (e: unknown) => void = () => {}): void {
    this.#stopWatch ??= watchVault(this.root, (files) => {
      this.userEdits(files).catch(onError);
    });
  }

  async close(): Promise<void> {
    this.#stopWatch?.();
    this.#stopWatch = null;
    clearInterval(this.#renew);
    await this.#queue;
    if (!this.#lost) await releaseLock(this.root, this.#lock);
  }
}
