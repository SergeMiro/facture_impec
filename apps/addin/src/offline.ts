// Offline (plan §5): an action that could not reach the API waits here and runs again when the
// connection is back. The task pane shows « en attente de connexion » while anything waits.
import { Offline } from './api';

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export const systemTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Waits between tries; the last one repeats. */
export const RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];

interface Item {
  label: string;
  run: () => Promise<void>;
}

export class OfflineQueue {
  /** Keyed so that the same action waits once (two « Vérifier » clicks = one sync). */
  readonly #items = new Map<string, Item>();
  readonly #onChange: (labels: string[]) => void;
  readonly #timers: Timers;
  #timer: unknown = null;
  #attempt = 0;
  #draining = false;

  constructor(onChange: (labels: string[]) => void, timers: Timers = systemTimers) {
    this.#onChange = onChange;
    this.#timers = timers;
  }

  get labels(): string[] {
    return [...this.#items.values()].map((i) => i.label);
  }

  /** `run` throws Offline to keep waiting; any other outcome takes it off the queue. */
  add(key: string, label: string, run: () => Promise<void>): void {
    this.#items.delete(key);
    this.#items.set(key, { label, run });
    this.#onChange(this.labels);
    this.#schedule();
  }

  /** The browser says the connection is back: try now instead of waiting. */
  retryNow(): void {
    if (this.#items.size === 0) return;
    this.#attempt = 0;
    if (this.#timer !== null) this.#timers.clearTimeout(this.#timer);
    this.#timer = null;
    void this.#drain();
  }

  clear(): void {
    if (this.#timer !== null) this.#timers.clearTimeout(this.#timer);
    this.#timer = null;
    this.#items.clear();
    this.#onChange([]);
  }

  #schedule(): void {
    if (this.#timer !== null || this.#draining || this.#items.size === 0) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.#attempt, RETRY_DELAYS_MS.length - 1)] ?? 60_000;
    this.#timer = this.#timers.setTimeout(() => {
      this.#timer = null;
      void this.#drain();
    }, delay);
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      for (const [key, item] of [...this.#items]) {
        try {
          await item.run();
        } catch (e) {
          if (e instanceof Offline) {
            this.#attempt++;
            return;
          }
        }
        // Done, or failed for a reason waiting will not fix (the action reported it itself).
        if (this.#items.get(key) === item) this.#items.delete(key);
        this.#onChange(this.labels);
      }
      this.#attempt = 0;
    } finally {
      this.#draining = false;
      this.#schedule();
    }
  }
}
