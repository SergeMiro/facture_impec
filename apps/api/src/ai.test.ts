import type { Database } from '@fi/db';
import { createMockPdpAdapter } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbRunStore, parisMidnight } from './ai';
import { newTenant, testApi, testDatabase } from './test-helpers';

let database: Database;

beforeAll(async () => {
  database = await testDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('parisMidnight', () => {
  it('finds midnight in Paris in winter, in summer and on the days the clocks change', () => {
    const at = (iso: string) => parisMidnight(new Date(iso)).toISOString();
    expect(at('2026-01-15T10:00:00Z')).toBe('2026-01-14T23:00:00.000Z');
    expect(at('2026-07-15T10:00:00Z')).toBe('2026-07-14T22:00:00.000Z');
    expect(at('2026-07-15T22:30:00Z')).toBe('2026-07-15T22:00:00.000Z');
    expect(at('2026-03-29T12:00:00Z')).toBe('2026-03-28T23:00:00.000Z');
    expect(at('2026-10-25T12:00:00Z')).toBe('2026-10-24T22:00:00.000Z');
  });
});

describe('DbRunStore', () => {
  it("counts a tenant's tokens since midnight in Paris, and nobody else's", async () => {
    const mock = createMockPdpAdapter({ baseUrl: 'http://mock.invalid', webhookSecret: 'x' });
    const { request } = testApi(database, { mock });
    const [a, b] = [await newTenant(request), await newTenant(request)];
    let now = new Date('2026-10-18T21:30:00Z'); // 23:30 in Paris
    const store = new DbRunStore(database.db, () => now);
    const run = (tenantId: string, startedAt: string, tokens: number) =>
      store.record({
        tenantId,
        invoiceId: null,
        agent: 'mapping',
        provider: 'mistral',
        model: 'm',
        promptHash: 'h',
        status: 'ok',
        reason: null,
        attempts: 1,
        inputTokens: tokens,
        outputTokens: 10,
        error: null,
        startedAt,
        finishedAt: startedAt,
      });
    await run(a.id, '2026-10-17T21:59:00Z', 1000); // 23:59 the day before
    await run(a.id, '2026-10-17T22:01:00Z', 200);
    await run(a.id, '2026-10-18T21:00:00Z', 300);
    await run(b.id, '2026-10-18T10:00:00Z', 5000);
    expect(await store.tokensToday(a.id)).toBe(520);
    now = new Date('2026-10-18T22:30:00Z'); // 00:30 the next day
    expect(await store.tokensToday(a.id)).toBe(0);
  });
});
