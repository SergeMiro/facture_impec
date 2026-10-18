// StatusWriter (plan §5): the only way the add-in writes into a sheet. It touches nothing but the
// FI_Statut / FI_Détail columns and batches every write: at most one Excel sync per 500 ms.
import type { ExcelPort, StatusPlan, Tone } from './port';

export const WRITE_INTERVAL_MS = 500;

interface Pending {
  plan: StatusPlan;
  waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }>;
}

export interface WriterClock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

const systemClock: WriterClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

export class StatusWriter {
  readonly #port: ExcelPort;
  readonly #clock: WriterClock;
  readonly #intervalMs: number;
  /** One plan per sheet: a newer plan replaces one not yet written. */
  #pending = new Map<string, Pending>();
  #lastFlush = Number.NEGATIVE_INFINITY;
  #scheduled = false;
  #flushing = false;

  constructor(port: ExcelPort, clock: WriterClock = systemClock, intervalMs = WRITE_INTERVAL_MS) {
    this.#port = port;
    this.#clock = clock;
    this.#intervalMs = intervalMs;
  }

  /** Resolves once this plan (or a newer one for the same sheet) is in the sheet. */
  write(plan: StatusPlan): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiters = this.#pending.get(plan.sheet)?.waiters ?? [];
      waiters.push({ resolve, reject });
      this.#pending.set(plan.sheet, { plan, waiters });
      this.#schedule();
    });
  }

  #schedule(): void {
    if (this.#scheduled || this.#flushing || this.#pending.size === 0) return;
    this.#scheduled = true;
    const wait = Math.max(0, this.#lastFlush + this.#intervalMs - this.#clock.now());
    this.#clock.setTimeout(() => {
      this.#scheduled = false;
      void this.#flush();
    }, wait);
  }

  async #flush(): Promise<void> {
    const batch = [...this.#pending.values()];
    this.#pending.clear();
    this.#flushing = true;
    this.#lastFlush = this.#clock.now();
    try {
      await this.#port.writeStatus(batch.map((p) => p.plan));
      for (const p of batch) for (const w of p.waiters) w.resolve();
    } catch (e) {
      for (const p of batch) for (const w of p.waiters) w.reject(e);
    } finally {
      this.#flushing = false;
      this.#schedule();
    }
  }
}

/** Cell fills of FI_Statut; neutral clears the fill. */
export const TONE_FILL: Record<Exclude<Tone, 'neutral'>, string> = {
  ok: '#DFF6DD',
  warning: '#FFF4CE',
  error: '#FDE7E9',
  progress: '#DEECF9',
};

/** Text Excel would read as a formula stays text. */
export const asText = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s);

/** The column values to write (headerRow + 1 … lastRow) and the fills, as runs of equal tone. */
export function planValues(plan: StatusPlan) {
  const first = plan.headerRow + 1;
  const byRow = new Map(plan.cells.map((c) => [c.row, c]));
  const rows = Array.from({ length: Math.max(0, plan.lastRow - first + 1) }, (_, i) => first + i);
  const status = rows.map((r) => [asText(byRow.get(r)?.status ?? '')]);
  const detail = rows.map((r) => [asText(byRow.get(r)?.detail ?? '')]);
  const fills: Array<{ from: number; to: number; color: string }> = [];
  for (const r of rows) {
    const tone = byRow.get(r)?.tone ?? 'neutral';
    if (tone === 'neutral') continue;
    const color = TONE_FILL[tone];
    const last = fills.at(-1);
    if (last && last.to === r - 1 && last.color === color) last.to = r;
    else fills.push({ from: r, to: r, color });
  }
  return { first, status, detail, fills };
}
