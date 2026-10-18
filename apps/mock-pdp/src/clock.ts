// The mock's only source of time (plan §3: "deterministic clock injectable for tests").

export interface Clock {
  now(): Date;
  /** Runs `fn` after `ms` milliseconds of this clock; returns a function that cancels it. */
  setTimeout(fn: () => void, ms: number): () => void;
}

/** Node fires a longer timeout at once (TimeoutOverflowWarning): longer waits go in steps. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

export const systemClock: Clock = {
  now: () => new Date(),
  setTimeout(fn, ms) {
    let handle: NodeJS.Timeout;
    const wait = (left: number) => {
      const step = Math.min(left, MAX_TIMEOUT_MS);
      handle = setTimeout(() => (left > step ? wait(left - step) : fn()), step);
      handle.unref();
    };
    wait(Math.max(0, ms));
    return () => clearTimeout(handle);
  },
};

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

/** Time moves only when a test calls `advance`; due timers run in order, each with its own time. */
export class ManualClock implements Clock {
  #now: number;
  #timers: Timer[] = [];
  #seq = 0;

  constructor(start: Date | string = '2026-10-15T08:00:00Z') {
    this.#now = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  setTimeout(fn: () => void, ms: number): () => void {
    const timer = { at: this.#now + Math.max(0, ms), seq: ++this.#seq, fn };
    this.#timers.push(timer);
    return () => {
      this.#timers = this.#timers.filter((t) => t !== timer);
    };
  }

  /** Moves time forward by `ms`, running every timer that falls due, including ones they schedule. */
  async advance(ms: number): Promise<void> {
    const end = this.#now + ms;
    for (;;) {
      const next = this.#timers
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.#timers = this.#timers.filter((t) => t !== next);
      this.#now = next.at;
      next.fn();
      // Lets async work started by the timer (webhook deliveries) run before the next one.
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.#now = end;
  }

  get pending(): number {
    return this.#timers.length;
  }
}
