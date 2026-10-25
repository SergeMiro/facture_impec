// The vault as its one writer holds it (memory doc §6): the lock taken and renewed, the vault read
// again at opening, then every write (an agent's patch, a person's edits, a rebuild) one after the
// other, never two at once, each followed by the index in the database when there is one (M1).
// Recall reads that index; what it finds in `raw/` is written back onto its page, and what it does
// not find, or finds twice, becomes an open question. The runner (M3) opens it once and keeps it.
import { parisToday } from '@fi/core';
import { t } from '@fi/shared';
import { compile, type MemoryPatch, type PageFacts, type VaultOptions } from './compile';
import { acquireLock, LOCK_TTL_MS, type LockFile, releaseLock, renewLock } from './lock';
import type { Page } from './page';
import { addRaw, type RawFile, readRawTexts } from './raw';
import { classify, pageFiles, rebuild } from './rebuild';
import { type RecallAnswer, type RecallQuery, recall } from './recall';
import type { MemoryStore } from './store';
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

export class MemoryVault {
  #queue: Promise<unknown> = Promise.resolve();
  #lock: LockFile;
  #lost: Error | null = null;
  #renew: NodeJS.Timeout;
  #stopWatch: (() => void) | null = null;

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

  compile(patch: MemoryPatch) {
    return this.#serial(async () => {
      const done = await this.#compile(patch);
      if (done.ok) await this.options.store?.upsert(await this.#pages(done.written));
      return done;
    });
  }

  rebuild() {
    return this.#serial(async () => {
      const done = await rebuild(this.root, { now: this.#now() });
      const { store } = this.options;
      if (store) {
        const invalid = new Set(done.invalid);
        const files = (await pageFiles(this.root)).filter((f) => !invalid.has(f));
        const pages = await this.#pages(files.map((f) => f.replace(/\.md$/, '')));
        await store.replace(pages, await readRawTexts(this.root));
      }
      return done;
    });
  }

  userEdits(files: readonly string[]) {
    return this.#serial(async () => {
      const done = await applyUserEdits(this.root, files, { now: this.#now() });
      const { store } = this.options;
      if (store) {
        await store.upsert(await this.#pages(done.accepted));
        await store.remove([...done.removed, ...done.invalid.map((f) => f.replace(/\.md$/, ''))]);
      }
      return done;
    });
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
        const { updated: _u, backlinks: _b, ...facts } = page.frontmatter;
        const sources = [...new Set([...facts.sources, ref])];
        const done = await this.#compile({
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
        if (done.ok) await store.upsert(await this.#pages(done.written));
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
