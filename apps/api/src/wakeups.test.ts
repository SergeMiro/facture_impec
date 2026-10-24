// BTP stage 7B (docs/plans/phase-7.md): a worker does not wait out pg-boss's polling interval when
// there is work. Here the interval is 10 s, and documents are read and checked well within it.
import { type Database, documents, inArray, openDatabase } from '@fi/db';
import { ServerEnvSchema } from '@fi/shared/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOLDEN_COMPANIES, goldenDocuments } from '../scripts/golden/documents';
import { type RunningApi, startApi } from './runtime';
import { fakeAdapter, newTenant, testApi } from './test-helpers';

let database: Database;
let api: RunningApi;

beforeAll(async () => {
  database = await openDatabase({});
  const env = ServerEnvSchema.parse({
    FI_ENV: 'local',
    ADMIN_TOKEN: 'a'.repeat(32),
    PDP_SYNC_INTERVAL_SECONDS: '3600',
  });
  api = await startApi({ env, port: 0, database, pollingIntervalSeconds: 10, mailer: null });
});
afterAll(async () => {
  await api?.close();
});

describe('the workers', () => {
  it('take a job sent from the process at once, and the next one after each job', async () => {
    const xml = (await goldenDocuments()).find(
      (d) => 'format' in d.expect && d.expect.format === 'ubl' && d.expect.stage === 'done',
    );
    if (!xml) throw new Error('no UBL golden that ends done');
    const { request } = testApi(database, { mock: fakeAdapter() });
    const company = await newTenant(request, GOLDEN_COMPANIES[xml.to]);
    // The workers' first fetch, as they started, found nothing: without a wake-up they would look
    // again in 10 s, and two of them would read six documents in 30 s.
    const started = performance.now();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const tail = new TextEncoder().encode(`\n<!-- copy ${i} -->\n`);
      const body = new Uint8Array([...xml.bytes, ...tail]);
      const res = await fetch(`${api.url}/ingest?name=${i}-${encodeURIComponent(xml.name)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${company.apiKey}` },
        body,
      });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as { id: string }).id);
    }
    for (;;) {
      const rows = await database.db
        .select({ stage: documents.stage })
        .from(documents)
        .where(inArray(documents.id, ids));
      if (rows.every((r) => r.stage === 'done' || r.stage === 'needs_review')) break;
      expect(performance.now() - started, 'settled before the next poll').toBeLessThan(8_000);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
});
