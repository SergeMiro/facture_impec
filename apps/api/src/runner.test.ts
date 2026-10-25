// Memory M3 (docs/plans/memory.md): the API as the company's runner. A stop of 30 hours on a test
// clock, then a start: every schedule runs once, the database is dumped once, and the document the
// stop left half way reaches its last stage. The vault is held by one runner at a time.
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documents, eq, openDatabase, tenants } from '@fi/db';
import { LOCK, VaultLocked } from '@fi/memory';
import { ServerEnvSchema } from '@fi/shared/env';
import { afterAll, describe, expect, it } from 'vitest';
import { GOLDEN_COMPANIES, goldenDocuments } from '../scripts/golden/documents';
import { DUMPS_DIR, DUMPS_KEPT, dumpDatabase, openRunner, restoreDump } from './runner';
import { type RunningApi, startApi } from './runtime';
import { dailyDue, lastRun, ran, scheduleRunsNow } from './schedules';
import { ADMIN_TOKEN, fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';

const made: string[] = [];
const temp = async (name: string) => {
  const dir = await mkdtemp(join(tmpdir(), `fi-runner-${name}-`));
  made.push(dir);
  return dir;
};
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const runnerEnv = (vault: string, data: string) =>
  ServerEnvSchema.parse({
    VAULT_DIR: vault,
    PGLITE_DIR: data,
    ADMIN_TOKEN,
    PDP_SYNC_INTERVAL_SECONDS: '3600',
  });
const quiet = () => {};

async function until<T>(check: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const found = await check();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`never: ${what}`);
}

// Each test migrates a PGlite database of its own: seconds, under the whole gate's load.
const SLOW = { timeout: 60_000 };

describe('a daily task', () => {
  // Paris is UTC+1 from 25 October 2026.
  const at = (iso: string) => new Date(iso);
  it('is due once its hour has passed since its last run, once however many days were missed', () => {
    expect(dailyDue(undefined, at('2026-10-26T10:00:00Z'), 3)).toBe(true);
    const night = at('2026-10-26T02:30:00Z');
    expect(dailyDue(night, at('2026-10-26T10:00:00Z'), 3)).toBe(false);
    expect(dailyDue(night, at('2026-10-27T01:59:00Z'), 3)).toBe(false);
    expect(dailyDue(night, at('2026-10-27T02:00:00Z'), 3)).toBe(true);
    expect(dailyDue(at('2026-10-26T02:00:00Z'), at('2026-10-26T10:00:00Z'), 3)).toBe(false);
    expect(dailyDue(at('2026-10-26T01:59:00Z'), at('2026-10-26T10:00:00Z'), 3)).toBe(true);
    const away = at('2026-10-20T10:00:00Z');
    expect(dailyDue(away, at('2026-10-26T10:00:00Z'), 3)).toBe(true);
    expect(dailyDue(at('2026-10-26T10:00:00Z'), at('2026-10-26T11:00:00Z'), 3)).toBe(false);
  });

  it('keeps its last run and how many times it ran', SLOW, async () => {
    const database = await testDatabase();
    await ran(database.db, 'dump', at('2026-10-26T02:30:00Z'));
    await ran(database.db, 'dump', at('2026-10-27T02:30:00Z'));
    expect(await lastRun(database.db, 'dump')).toEqual({
      name: 'dump',
      lastRunAt: at('2026-10-27T02:30:00Z'),
      runs: 2,
    });
    await database.close();
  });
});

describe('the database dump', () => {
  it(
    'keeps the last seven, leaves no half-written file, and restores into an empty folder',
    SLOW,
    async () => {
      const database = await testDatabase();
      const { request } = testApi(database, { mock: fakeAdapter() });
      const company = await newTenant(request, GOLDEN_COMPANIES.buyer);
      const vault = await temp('vault');
      const dir = join(vault, DUMPS_DIR);
      // A week of dumps already there, and one a power cut left half written.
      await mkdir(dir, { recursive: true });
      for (let day = 10; day <= 16; day++)
        await writeFile(join(dir, `base-2026-10-${day}.tar.gz`), '');
      await writeFile(join(dir, 'base-2026-10-17.tar.gz.tmp-cut'), 'cut short');
      for (const day of [17, 18]) {
        const file = await dumpDatabase(database, vault, new Date(`2026-10-${day}T10:00:00Z`));
        expect(file).toBe(`${DUMPS_DIR}/base-2026-10-${day}.tar.gz`);
      }
      const files = (await readdir(dir)).sort();
      expect(files).toHaveLength(DUMPS_KEPT);
      expect(files[0]).toBe('base-2026-10-12.tar.gz');
      expect(files.at(-1)).toBe('base-2026-10-18.tar.gz');
      await database.close();

      const last = join(dir, 'base-2026-10-18.tar.gz');
      await expect(restoreDump(last, vault)).rejects.toThrow(/empty/);
      const into = await temp('restored');
      expect(await restoreDump(last, into)).toEqual([GOLDEN_COMPANIES.buyer.name]);
      const restored = await openDatabase({ dir: into });
      const [row] = await restored.db.select().from(tenants).where(eq(tenants.id, company.id));
      expect(row?.siren).toBe(GOLDEN_COMPANIES.buyer.siren);
      await restored.close();
    },
  );
});

describe('the runner', () => {
  it('holds its vault alone, and lets it go when it stops', SLOW, async () => {
    const env = runnerEnv(await temp('vault'), await temp('data'));
    const database = await testDatabase();
    const options = { env, database, now: () => new Date(), log: quiet };
    const first = await openRunner(options);
    await expect(openRunner(options)).rejects.toBeInstanceOf(VaultLocked);
    await first?.close();
    const second = await openRunner(options);
    expect(second).not.toBeNull();
    await second?.close();
    await database.close();
  });

  it('serves one company: a database of two is refused', SLOW, async () => {
    const database = await testDatabase();
    const { request } = testApi(database, { mock: fakeAdapter() });
    await newTenant(request, GOLDEN_COMPANIES.buyer);
    await newTenant(request, GOLDEN_COMPANIES.seller);
    const env = runnerEnv(await temp('vault'), await temp('data'));
    await expect(openRunner({ env, database, now: () => new Date(), log: quiet })).rejects.toThrow(
      /one company/,
    );
    await database.close();
  });

  it('is none without VAULT_DIR: the hosted API', SLOW, async () => {
    const database = await testDatabase();
    const env = ServerEnvSchema.parse({});
    expect(await openRunner({ env, database, now: () => new Date(), log: quiet })).toBeNull();
    await database.close();
  });

  it('stopped 30 hours, runs every schedule once at start and leaves no document half way', {
    timeout: 120_000,
  }, async () => {
    const vault = await temp('vault');
    const env = runnerEnv(vault, await temp('data'));
    let clock = new Date();
    const start = () =>
      startApi({
        env,
        port: 0,
        now: () => clock,
        pollingIntervalSeconds: 0.5,
        collectEverySeconds: 3600,
        mailer: null,
        directory: null,
        vies: null,
        log: quiet,
      });
    const runs = async (api: RunningApi) =>
      Object.fromEntries((await scheduleRunsNow(api.database.db)).map((r) => [r.name, r.runs]));
    const SCHEDULES = ['chasing', 'dump', 'purge', 'sweep', 'watchers', 'weekly'];
    const settled = (api: RunningApi, count: number) =>
      until(async () => {
        await api.runner?.catchUp();
        const now = await runs(api);
        return SCHEDULES.every((s) => now[s] === count) ? now : undefined;
      }, `every schedule at ${count}`);

    // A first day: the schedules run as it starts, then a document arrives that no worker reads
    // before the stop (its jobs recorded, not queued).
    let api = await start();
    expect(await stat(join(vault, LOCK))).toBeTruthy();
    await settled(api, 1);
    const xml = (await goldenDocuments()).find(
      (d) => 'format' in d.expect && d.expect.format === 'ubl' && d.expect.stage === 'done',
    );
    if (!xml) throw new Error('no UBL golden that ends done');
    const { request } = testApi(api.database, { mock: fakeAdapter() });
    const company = await newTenant(request, GOLDEN_COMPANIES[xml.to]);
    const sent = await request(`/ingest?name=${encodeURIComponent(xml.name)}`, {
      method: 'POST',
      token: company.apiKey,
      body: xml.bytes,
    });
    expect(sent.status).toBe(201);
    const { id } = (await sent.json()) as { id: string };
    const stage = async () =>
      (await api.database.db.select().from(documents).where(eq(documents.id, id)))[0]?.stage;
    expect(await stage()).toBe('ingested');
    await api.close();

    // Thirty hours later.
    clock = new Date(clock.getTime() + 30 * 3_600_000);
    api = await start();
    expect(api.runner?.vault).toBeDefined();
    expect(await settled(api, 2)).toMatchObject({ dump: 2 });
    await api.runner?.catchUp();
    expect((await runs(api)).dump).toBe(2);
    expect(await until(async () => ((await stage()) === 'done' ? 'done' : undefined), 'done')).toBe(
      'done',
    );
    expect(
      (await readdir(join(vault, DUMPS_DIR))).filter((f) => f.endsWith('.tar.gz')),
    ).toHaveLength(2);
    await api.close();
    await expect(stat(join(vault, LOCK))).rejects.toThrow();
  });
});
