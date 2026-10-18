import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { MemoryRunStore, Orchestrator, type RunRequest, retryable, routeFor } from './orchestrator';
import { AiDisabledError } from './providers/models';

const usage = { inputTokens: 10, outputTokens: 5 };

function setup(budget = { runTokens: 1000, tenantDailyTokens: 100 }) {
  const store = new MemoryRunStore();
  const sleeps: number[] = [];
  const orchestrator = new Orchestrator({
    store,
    budget,
    now: () => new Date('2026-10-18T10:00:00Z'),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { store, sleeps, orchestrator };
}

const req = <T>(
  call: RunRequest<T>['call'],
  extra: Partial<RunRequest<T>> = {},
): RunRequest<T> => ({
  tenantId: 't1',
  phase: 'explain',
  provider: 'mock',
  model: 'm',
  promptHash: 'h',
  estimatedTokens: 10,
  call,
  ...extra,
});

const apiError = (statusCode: number, isRetryable: boolean) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://x',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });

describe('Orchestrator', () => {
  it('routes phases to agents deterministically', () => {
    expect([routeFor('detect'), routeFor('explain'), routeFor('rehearse')]).toEqual([
      'mapping',
      'explain',
      'test',
    ]);
  });

  it('records a successful run with its tokens', async () => {
    const { store, orchestrator } = setup();
    const out = await orchestrator.run(
      req(async () => ({ output: 'ok', usage }), { invoiceId: 'i1' }),
    );
    expect(out).toEqual({ ok: true, output: 'ok', usage });
    expect(store.runs).toEqual([
      expect.objectContaining({
        tenantId: 't1',
        invoiceId: 'i1',
        agent: 'explain',
        status: 'ok',
        attempts: 1,
        inputTokens: 10,
        outputTokens: 5,
        startedAt: '2026-10-18T10:00:00.000Z',
      }),
    ]);
  });

  it('retries three times with backoff, then fails without throwing', async () => {
    const { store, sleeps, orchestrator } = setup();
    let calls = 0;
    const out = await orchestrator.run(
      req(async () => {
        calls++;
        throw apiError(503, true);
      }),
    );
    expect(out).toEqual({ ok: false, reason: 'error' });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([500, 1000, 2000]);
    expect(store.runs[0]).toMatchObject({
      status: 'failed',
      attempts: 4,
      error: expect.stringContaining('503'),
    });
  });

  it('stops at once on an error that will not go away, and counts tokens of a late success', async () => {
    const { store, orchestrator } = setup();
    expect(await orchestrator.run(req(async () => Promise.reject(apiError(401, false))))).toEqual({
      ok: false,
      reason: 'error',
    });
    expect(store.runs[0]?.attempts).toBe(1);
    let n = 0;
    const out = await orchestrator.run(
      req(async () => {
        if (n++ === 0) throw new Error('bad JSON');
        return { output: 1, usage };
      }),
    );
    expect(out.ok).toBe(true);
    expect(store.runs[1]).toMatchObject({ status: 'ok', attempts: 2 });
  });

  it('skips when AI is off, the run is too big or the daily budget is spent', async () => {
    const { store, orchestrator } = setup();
    expect(await orchestrator.run(req(async () => Promise.reject(new AiDisabledError())))).toEqual({
      ok: false,
      reason: 'ai_off',
    });
    expect(
      await orchestrator.run(req(async () => ({ output: 1, usage }), { estimatedTokens: 5000 })),
    ).toEqual({
      ok: false,
      reason: 'run_budget',
    });
    for (let i = 0; i < 7; i++) await orchestrator.run(req(async () => ({ output: 1, usage })));
    expect(await orchestrator.run(req(async () => ({ output: 1, usage })))).toEqual({
      ok: false,
      reason: 'daily_budget',
    });
    expect(store.runs.map((r) => r.reason).filter(Boolean)).toEqual([
      'ai_off',
      'run_budget',
      'daily_budget',
    ]);
  });

  it('does not retry once the caller gave up', async () => {
    const { orchestrator } = setup();
    const controller = new AbortController();
    let calls = 0;
    const out = await orchestrator.run(
      req(
        async () => {
          calls++;
          controller.abort();
          throw new Error('aborted');
        },
        { signal: controller.signal },
      ),
    );
    expect(out.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('runs one call at a time per invoice and two per tenant', async () => {
    const { orchestrator } = setup({ runTokens: 1000, tenantDailyTokens: 1e9 });
    let active = 0;
    let peak = 0;
    const perInvoice = new Map<string, number>();
    let invoicePeak = 0;
    const job = (invoiceId: string) =>
      orchestrator.run(
        req(
          async () => {
            active++;
            perInvoice.set(invoiceId, (perInvoice.get(invoiceId) ?? 0) + 1);
            peak = Math.max(peak, active);
            invoicePeak = Math.max(invoicePeak, perInvoice.get(invoiceId) ?? 0);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            perInvoice.set(invoiceId, (perInvoice.get(invoiceId) ?? 1) - 1);
            return { output: invoiceId, usage };
          },
          { invoiceId },
        ),
      );
    const results = await Promise.all(['a', 'a', 'b', 'c', 'd', 'a'].map(job));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBe(2);
    expect(invoicePeak).toBe(1);
  });

  it('times out a hanging attempt and retries it', async () => {
    const store = new MemoryRunStore();
    const orchestrator = new Orchestrator({
      store,
      budget: { runTokens: 1000, tenantDailyTokens: 1000 },
      sleep: async () => {},
      timeoutMs: 5,
      retries: 1,
    });
    let calls = 0;
    const out = await orchestrator.run(
      req(
        (signal) =>
          new Promise<{ output: string; usage: typeof usage }>((resolve, reject) => {
            calls++;
            if (calls === 2) resolve({ output: 'late', usage });
            signal.addEventListener('abort', () => reject(new Error('timeout')));
          }),
      ),
    );
    expect(out).toEqual({ ok: true, output: 'late', usage });
    expect(calls).toBe(2);
  });

  it('classifies errors for retry', () => {
    expect(retryable(new AiDisabledError())).toBe(false);
    expect(retryable(apiError(429, true))).toBe(true);
    expect(retryable(apiError(400, false))).toBe(false);
    expect(retryable('weird')).toBe(true);
  });
});
