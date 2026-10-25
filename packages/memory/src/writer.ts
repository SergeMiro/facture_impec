// The vault as its one writer holds it (memory doc §6): the lock taken and renewed, the vault read
// again at opening, then every write (an agent's patch, a person's edits, a rebuild) one after the
// other, never two at once. The runner (M3) opens it once and keeps it.
import { compile, type MemoryPatch, type VaultOptions } from './compile';
import { acquireLock, LOCK_TTL_MS, type LockFile, releaseLock, renewLock } from './lock';
import { rebuild } from './rebuild';
import { applyUserEdits, watchVault } from './watch';

export interface MemoryVaultOptions extends Omit<VaultOptions, 'now'> {
  host: string;
  pid?: number;
  clock?: () => Date;
  ttlMs?: number;
}

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

  compile(patch: MemoryPatch) {
    const { rh, sourceExists } = this.options;
    return this.#serial(() =>
      compile(this.root, patch, {
        now: this.#now(),
        ...(rh !== undefined && { rh }),
        ...(sourceExists && { sourceExists }),
      }),
    );
  }

  rebuild() {
    return this.#serial(() => rebuild(this.root, { now: this.#now() }));
  }

  userEdits(files: readonly string[]) {
    return this.#serial(() => applyUserEdits(this.root, files, { now: this.#now() }));
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
