// Runs every agent call (plan §6): deterministic routing, one run at a time per invoice, two per
// tenant, a token cap per run and per tenant per day, three retries with backoff. A failed run never
// changes an invoice: the caller gets `ok: false` and falls back to the deterministic answer. Every
// run, skipped ones included, is written to agent_runs through the RunStore.
import { APICallError } from 'ai';
import type { Usage } from './llm';
import { AiDisabledError } from './providers/models';

export const PHASES = {
  detect: 'mapping',
  explain: 'explain',
  rehearse: 'test',
  monitor: 'monitor',
} as const;
export type Phase = keyof typeof PHASES;
export type AgentName = (typeof PHASES)[Phase];

/** Phase → agent. No model chooses which agent runs. */
export const routeFor = (phase: Phase): AgentName => PHASES[phase];

export type RunStatus = 'ok' | 'failed' | 'skipped';
export type SkipReason = 'ai_off' | 'daily_budget' | 'run_budget';

export interface RunRecord {
  tenantId: string;
  invoiceId: string | null;
  agent: AgentName;
  provider: string;
  model: string;
  promptHash: string;
  status: RunStatus;
  reason: SkipReason | 'error' | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  /** English, for operators; never shown to the tenant and never contains invoice data. */
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface RunStore {
  record(run: RunRecord): Promise<void>;
  /** Tokens (input + output) the tenant used today, Europe/Paris. */
  tokensToday(tenantId: string): Promise<number>;
}

export interface Budget {
  /** Refuse a run whose estimated input is above this. */
  runTokens: number;
  /** Refuse runs once the tenant used this many tokens today. */
  tenantDailyTokens: number;
}

export interface RunRequest<T> {
  tenantId: string;
  invoiceId?: string;
  phase: Phase;
  provider: string;
  model: string;
  promptHash: string;
  estimatedTokens: number;
  call: (signal: AbortSignal) => Promise<{ output: T; usage: Usage }>;
  signal?: AbortSignal;
}

export type RunOutcome<T> =
  | { ok: true; output: T; usage: Usage }
  | { ok: false; reason: SkipReason | 'error' };

export interface OrchestratorOptions {
  store: RunStore;
  budget: Budget;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
  perTenant?: number;
  /** Per attempt. */
  timeoutMs?: number;
}

/** A queue of waiters: `acquire` resolves when fewer than `limit` holders run. */
class Semaphore {
  #active = 0;
  readonly #waiting: Array<() => void> = [];
  constructor(readonly limit: number) {}

  async acquire(): Promise<() => void> {
    // A released slot passes straight to the next waiter, so nobody can slip in between.
    if (this.#active < this.limit) this.#active++;
    else await new Promise<void>((r) => this.#waiting.push(r));
    return () => {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active--;
    };
  }

  get idle() {
    return this.#active === 0 && this.#waiting.length === 0;
  }
}

/** Errors worth another attempt: rate limits, overloads, timeouts, malformed answers. */
export function retryable(error: unknown): boolean {
  if (error instanceof AiDisabledError) return false;
  if (APICallError.isInstance(error)) return error.isRetryable;
  return true;
}

const message = (error: unknown) =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);

export class Orchestrator {
  readonly #store: RunStore;
  readonly #budget: Budget;
  readonly #now: () => Date;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #retries: number;
  readonly #perTenant: number;
  readonly #timeoutMs: number;
  readonly #tenants = new Map<string, Semaphore>();
  readonly #invoices = new Map<string, Semaphore>();

  constructor(options: OrchestratorOptions) {
    this.#store = options.store;
    this.#budget = options.budget;
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#retries = options.retries ?? 3;
    this.#perTenant = options.perTenant ?? 2;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  #lock(map: Map<string, Semaphore>, key: string, limit: number) {
    let s = map.get(key);
    if (!s) {
      s = new Semaphore(limit);
      map.set(key, s);
    }
    return s;
  }

  #forget(map: Map<string, Semaphore>, key: string) {
    if (map.get(key)?.idle) map.delete(key);
  }

  async run<T>(req: RunRequest<T>): Promise<RunOutcome<T>> {
    const startedAt = this.#now().toISOString();
    const base = {
      tenantId: req.tenantId,
      invoiceId: req.invoiceId ?? null,
      agent: routeFor(req.phase),
      provider: req.provider,
      model: req.model,
      promptHash: req.promptHash,
      startedAt,
    };
    const finish = async (
      status: RunStatus,
      reason: RunRecord['reason'],
      extra: Partial<RunRecord> = {},
    ) => {
      await this.#store.record({
        ...base,
        status,
        reason,
        attempts: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: null,
        finishedAt: this.#now().toISOString(),
        ...extra,
      });
    };

    if (req.estimatedTokens > this.#budget.runTokens) {
      await finish('skipped', 'run_budget');
      return { ok: false, reason: 'run_budget' };
    }
    if ((await this.#store.tokensToday(req.tenantId)) >= this.#budget.tenantDailyTokens) {
      await finish('skipped', 'daily_budget');
      return { ok: false, reason: 'daily_budget' };
    }

    const invoiceKey = `${req.tenantId}:${req.invoiceId ?? '-'}`;
    const releaseInvoice = req.invoiceId
      ? await this.#lock(this.#invoices, invoiceKey, 1).acquire()
      : () => {};
    const releaseTenant = await this.#lock(this.#tenants, req.tenantId, this.#perTenant).acquire();
    let attempts = 0;
    const used: Usage = { inputTokens: 0, outputTokens: 0 };
    try {
      for (;;) {
        attempts++;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
        const onAbort = () => controller.abort();
        req.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          const { output, usage } = await req.call(controller.signal);
          used.inputTokens += usage.inputTokens;
          used.outputTokens += usage.outputTokens;
          await finish('ok', null, { attempts, ...used });
          return { ok: true, output, usage: used };
        } catch (error) {
          if (error instanceof AiDisabledError) {
            await finish('skipped', 'ai_off', { attempts });
            return { ok: false, reason: 'ai_off' };
          }
          if (attempts > this.#retries || !retryable(error) || req.signal?.aborted) {
            await finish('failed', 'error', { attempts, ...used, error: message(error) });
            return { ok: false, reason: 'error' };
          }
          await this.#sleep(500 * 2 ** (attempts - 1));
        } finally {
          clearTimeout(timer);
          req.signal?.removeEventListener('abort', onAbort);
        }
      }
    } finally {
      releaseTenant();
      releaseInvoice();
      this.#forget(this.#tenants, req.tenantId);
      this.#forget(this.#invoices, invoiceKey);
    }
  }
}

/** A RunStore in memory, for tests and the eval scripts. */
export class MemoryRunStore implements RunStore {
  readonly runs: RunRecord[] = [];
  async record(run: RunRecord) {
    this.runs.push(run);
  }
  async tokensToday(tenantId: string) {
    return this.runs
      .filter((r) => r.tenantId === tenantId)
      .reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);
  }
}
