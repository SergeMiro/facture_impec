// BTP stage 7A (docs/DECISIONS.md D10): the JSON log lines and what /metrics says, on a running API
// with its pg-boss workers (PGlite in memory).
import { readFileSync } from 'node:fs';
import { connectorSyncs, type Database, openDatabase } from '@fi/db';
import { ServerEnvSchema } from '@fi/shared/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOLDEN_COMPANIES, goldenDocuments } from '../scripts/golden/documents';
import { QUEUES } from './jobs';
import { captureLogs, type LogLine, logLine, setLogTenant, withLogContext } from './log';
import { readOf } from './metrics';
import { type RunningApi, startApi } from './runtime';
import { fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';

const METRICS_TOKEN = 'm'.repeat(32);

let database: Database;
let api: RunningApi;
const lines: LogLine[] = [];
let release: () => void;

beforeAll(async () => {
  release = captureLogs((line) => lines.push(JSON.parse(line) as LogLine));
  database = await openDatabase({});
  const env = ServerEnvSchema.parse({
    FI_ENV: 'local',
    ADMIN_TOKEN: 'a'.repeat(32),
    METRICS_TOKEN,
    PDP_SYNC_INTERVAL_SECONDS: '3600',
  });
  api = await startApi({ env, port: 0, database, pollingIntervalSeconds: 0.5, mailer: null });
});
afterAll(async () => {
  await api?.close();
  release();
});

const scrape = async () => {
  const res = await fetch(`${api.url}/metrics`, {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
  expect(res.status).toBe(200);
  return res.text();
};

/** The value of one series, or undefined when /metrics does not write it. */
const seriesValue = (text: string, series: string) => {
  const line = text.split('\n').find((l) => l.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
};

async function until<T>(check: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const found = await check();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`never: ${what}`);
}

describe('GET /metrics', () => {
  it('answers Prometheus with its own token only, and does not exist without one', async () => {
    const wrong = await fetch(`${api.url}/metrics`, { headers: { authorization: 'Bearer x' } });
    expect(wrong.status).toBe(401);
    const admin = await fetch(`${api.url}/metrics`, {
      headers: { authorization: `Bearer ${'a'.repeat(32)}` },
    });
    expect(admin.status).toBe(401);
    const res = await fetch(`${api.url}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(res.headers.get('content-type')).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(await res.text()).toMatch(/^# HELP /);

    const { request } = testApi(database, { mock: fakeAdapter() });
    expect((await request('/metrics', { token: METRICS_TOKEN })).status).toBe(404);
  });

  it('answers on a database whose queues were never started, without them', async () => {
    const bare = await testDatabase();
    const { request } = testApi(bare, { mock: fakeAdapter() }, undefined, {
      env: { METRICS_TOKEN },
    });
    const res = await request('/metrics', { token: METRICS_TOKEN });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('# TYPE fi_jobs_waiting gauge');
    expect(text).not.toMatch(/^fi_jobs_waiting\{/m);
    expect(seriesValue(text, 'fi_tenants_deciding_7d')).toBe(0);
  });

  it('times requests by route pattern, never by id, and gives each its id', async () => {
    const id = crypto.randomUUID();
    const res = await fetch(`${api.url}/documents/${id}`);
    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    await fetch(`${api.url}/nowhere/${id}`);

    const text = await scrape();
    expect(text).not.toContain(id);
    expect(
      seriesValue(
        text,
        'fi_http_request_duration_seconds_count{method="GET",route="/documents/:id",status="4xx"}',
      ),
    ).toBe(1);
    expect(
      seriesValue(
        text,
        'fi_http_request_duration_seconds_count{method="GET",route="unmatched",status="4xx"}',
      ),
    ).toBe(1);
    // The budget of BTP plan §11 for GET /obligations is a bucket's edge.
    expect(text).toContain('le="0.2"');
  });

  it('counts a job that failed for good, logs it with its ids, and times it by queue', async () => {
    const jobId = await api.boss.send(
      QUEUES.ingest,
      { documentId: 'not-a-document' },
      { retryLimit: 0 },
    );
    const failed = await until(async () => {
      const value = seriesValue(
        await scrape(),
        `fi_jobs_failed_last_hour{queue="${QUEUES.ingest}"}`,
      );
      return value ? value : undefined;
    }, 'the job failed');
    expect(failed).toBe(1);
    const line = lines.find((l) => l.msg === 'job failed' && l.jobId === jobId);
    expect(line).toMatchObject({ level: 'error', queue: QUEUES.ingest, tenantId: null });
    expect(line?.error).toContain('documentId');
    const text = await scrape();
    expect(
      seriesValue(text, `fi_job_duration_seconds_count{queue="${QUEUES.ingest}",outcome="failed"}`),
    ).toBe(1);
    expect(seriesValue(text, `fi_jobs_waiting{queue="${QUEUES.ingest}"}`)).toBe(0);
    // Every queue has its line, a queue that never had a job too; pg-boss's own do not.
    for (const queue of Object.values(QUEUES)) {
      expect(seriesValue(text, `fi_jobs_failed_last_hour{queue="${queue}"}`), queue).toBeDefined();
    }
    expect(text).not.toContain('__pgboss__');
    expect(seriesValue(text, 'fi_tenants_deciding_7d')).toBe(0);
  });

  it('warns of an attempt pg-boss retries and logs an error only for the last', async () => {
    const jobId = await api.boss.send(
      QUEUES.ingest,
      { documentId: 'not-a-document' },
      { retryLimit: 1, retryDelay: 0 },
    );
    const last = await until(
      async () => lines.find((l) => l.jobId === jobId && l.msg === 'job failed'),
      'the second attempt failed',
    );
    expect(last).toMatchObject({ level: 'error', attempt: 2 });
    expect(lines.filter((l) => l.jobId === jobId).map((l) => [l.level, l.msg, l.attempt])).toEqual([
      ['warn', 'job attempt failed', 1],
      ['error', 'job failed', 2],
    ]);
  });

  it('times a document from its arrival to read and to settled, by how it was read', async () => {
    const xml = (await goldenDocuments()).find(
      (d) => 'format' in d.expect && d.expect.format === 'ubl' && d.expect.stage === 'done',
    );
    if (!xml) throw new Error('no UBL golden that ends done');
    const { request } = testApi(database, { mock: fakeAdapter() });
    const company = await newTenant(request, GOLDEN_COMPANIES[xml.to]);
    const res = await fetch(`${api.url}/ingest?name=${encodeURIComponent(xml.name)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${company.apiKey}` },
      body: xml.bytes,
    });
    expect(res.status).toBe(201);
    const settled = 'fi_document_settled_seconds_count{source="excel",read="xml",stage="done"}';
    expect(
      await until(async () => seriesValue(await scrape(), settled), 'the document settled'),
    ).toBe(1);
    const text = await scrape();
    expect(seriesValue(text, 'fi_document_read_seconds_count{source="excel",read="xml"}')).toBe(1);
    expect(
      seriesValue(text, `fi_job_duration_seconds_count{queue="${QUEUES.validate}",outcome="ok"}`),
    ).toBe(1);
  });

  it('tells how a document was read from what was read', () => {
    expect(readOf({ format: 'ubl', invoice: {} })).toBe('xml');
    expect(readOf({ text: 'Attestation', ocr: true })).toBe('ocr');
    expect(readOf({ text: 'Attestation', ocr: false })).toBe('text');
    expect(readOf({})).toBe('none');
    expect(readOf(null)).toBe('none');
  });

  it('writes every metric the alerts and the dashboard read, on routes that exist', async () => {
    const written = new Set(['up']);
    for (const [, name = '', type] of (await scrape()).matchAll(/^# TYPE (\S+) (\S+)$/gm)) {
      written.add(name);
      if (type === 'histogram')
        for (const end of ['_bucket', '_sum', '_count']) written.add(name + end);
    }
    const read = (file: string) =>
      readFileSync(new URL(`../../../deploy/observability/${file}`, import.meta.url), 'utf8');
    for (const file of ['alerts.yml', 'alerts.test.yml', 'grafana/dashboards/facture-impec.json']) {
      const named = new Set(read(file).match(/\bfi_[a-z0-9_]+/g));
      expect(named.size, file).toBeGreaterThan(0);
      for (const name of named) expect([...written], `${file}: ${name}`).toContain(name);
    }
    // A budget names a route by its pattern: one renamed in src/app.ts would never alert again.
    const { app } = testApi(database, { mock: fakeAdapter() });
    const budgeted = [...read('alerts.yml').matchAll(/method="(\w+)", route=~?"([^"]+)"/g)];
    expect(budgeted.length).toBeGreaterThan(0);
    for (const [, method, routes = ''] of budgeted) {
      for (const route of routes.split('|')) {
        expect(
          app.routes.some((r) => r.method === method && r.path === route),
          `${method} ${route}`,
        ).toBe(true);
      }
    }
  });

  it('says how long the oldest ERP import has been running', async () => {
    const { request } = testApi(database, { mock: fakeAdapter() });
    const company = await newTenant(request);
    const now = Date.now();
    await database.db.insert(connectorSyncs).values({
      tenantId: company.id,
      connector: 'export:chantiers',
      lastRunAt: new Date(now - 3 * 3_600_000),
      result: {
        file: null,
        startedAt: new Date(now - 3 * 3_600_000).toISOString(),
        finishedAt: null,
        added: 0,
        updated: 0,
        unchanged: 0,
        skipped: {},
        examples: [],
        withoutCustomer: 0,
      },
    });
    const seconds = seriesValue(
      await scrape(),
      'fi_erp_import_running_seconds{connector="export:chantiers"}',
    );
    expect(seconds).toBeGreaterThan(3 * 3_600 - 60);
  });
});

describe('the log lines', () => {
  it('carry the company of a signed-in request, its route and its id, when it fails', async () => {
    const { request } = testApi(database, { mock: fakeAdapter() });
    const company = await newTenant(request);
    // A clock that throws: the request fails after its key was read.
    const broken = testApi(database, { mock: fakeAdapter() }, undefined, {
      now: () => {
        throw new Error('the clock stopped');
      },
    });
    const res = await broken.request('/obligations', { token: company.apiKey });
    expect(res.status).toBe(500);
    const line = lines.find((l) => l.msg === 'request failed' && l.tenantId === company.id);
    expect(line).toMatchObject({
      level: 'error',
      method: 'GET',
      route: '/obligations',
      requestId: res.headers.get('x-request-id'),
    });
    expect(line?.error).toContain('the clock stopped');
  });

  it('always say which company, null when none', () => {
    const seen: LogLine[] = [];
    const restore = captureLogs((line) => seen.push(JSON.parse(line) as LogLine));
    try {
      logLine('info', 'outside');
      withLogContext({ tenantId: null, requestId: 'r1' }, () => {
        logLine('warn', 'before sign-in');
        setLogTenant('t1');
        logLine('warn', 'after sign-in');
      });
    } finally {
      restore();
    }
    expect(seen.map((l) => [l.msg, l.tenantId, l.requestId])).toEqual([
      ['outside', null, undefined],
      ['before sign-in', null, 'r1'],
      ['after sign-in', 't1', 'r1'],
    ]);
    for (const l of seen) expect(Object.keys(l)).toContain('tenantId');
  });
});
