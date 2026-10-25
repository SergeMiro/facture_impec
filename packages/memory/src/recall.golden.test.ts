import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { count, type Database, memoryRecalls, openDatabase, tenants } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_NOW, type Golden, writeDemoVault } from './demo';
import { LEVEL_BUDGET_MS, type RecallAnswer, recall } from './recall';
import { MemoryStore } from './store';
import { read, snapshot, tempVault } from './test-helpers';
import { MemoryVault } from './writer';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/vault-demo', import.meta.url));
const golden = async () =>
  JSON.parse(await readFile(join(FIXTURE, 'golden.json'), 'utf8')) as Golden[];

let database: Database;
let store: MemoryStore;
let vault: MemoryVault;
let root: string;

beforeAll(async () => {
  database = await openDatabase();
  await database.migrate();
  const [tenant] = await database.db
    .insert(tenants)
    .values({ name: 'Démo BTP', siren: '100000009', pdpProvider: 'mock', pdpAccount: 'demo' })
    .returning();
  if (!tenant) throw new Error('no tenant');
  store = new MemoryStore(database.db, tenant.id);
  root = await tempVault();
  await cp(join(FIXTURE, 'vault'), root, { recursive: true });
  vault = await MemoryVault.open(root, {
    host: 'test',
    clock: () => DEMO_NOW,
    sourceExists: () => true,
    store,
  });
}, 60_000);
afterAll(async () => {
  await vault.close();
  await database.close();
});

/** Whether `answer` is what the question expects; the reason when it is not. */
function check(g: Golden, answer: RecallAnswer): string | null {
  const e = g.expect;
  if (answer.status !== e.status) return `${answer.status} at level ${answer.level}`;
  if (answer.level > e.level) return `level ${answer.level}, expected ≤ ${e.level}`;
  if (e.paths) {
    const got = (answer.contradicts ?? answer.hits.map((h) => h.path)).toSorted();
    if (JSON.stringify(got) !== JSON.stringify(e.paths.toSorted()))
      return `pages ${got.join(', ')}`;
  }
  if ('value' in e && JSON.stringify(answer.hits[0]?.value) !== JSON.stringify(e.value)) {
    return `value ${JSON.stringify(answer.hits[0]?.value)}`;
  }
  return null;
}

const p95 = (list: number[]) => list.toSorted((a, b) => a - b)[Math.ceil(list.length * 0.95) - 1];

describe('the demo vault', () => {
  it('is what the generator makes, byte for byte', async () => {
    const fresh = await tempVault();
    const demo = await writeDemoVault(fresh);
    expect(await snapshot(fresh)).toEqual(await snapshot(join(FIXTURE, 'vault')));
    expect(await golden()).toEqual(demo.golden);
    expect(demo.golden).toHaveLength(100);
  });
});

describe('recall on the demo vault', () => {
  it('answers the golden questions: ≥ 80 % at levels 1–2, none wrongly « not found », in budget', async () => {
    const questions = await golden();
    await recall(store, questions[0]?.query ?? { intent: 'fact', question: 'x' }, { log: false });
    const wrong: string[] = [];
    const times: Record<number, number[]> = {};
    let top = 0;
    for (const g of questions) {
      const answer = await recall(store, g.query, { log: false });
      const miss = check(g, answer);
      if (miss) wrong.push(`${g.id} « ${g.query.question} »: ${miss}`);
      else if (answer.level <= 2) top++;
      times[answer.level] = [...(times[answer.level] ?? []), answer.levelMs];
    }
    const table = Object.entries(times).map(
      ([level, ms]) => `L${level}: ${ms.length} · p95 ${p95(ms)?.toFixed(1)} ms`,
    );
    console.info(`golden: ${top}/100 at levels 1–2; ${table.join(' · ')}`);
    expect(wrong).toEqual([]);
    expect(top).toBeGreaterThanOrEqual(80);
    for (const [level, budget] of Object.entries(LEVEL_BUDGET_MS)) {
      expect(p95(times[Number(level)] ?? [0]), `level ${level}`).toBeLessThanOrEqual(budget);
    }
  });

  it('writes an answer read in raw/ onto its page: asked again, it is found at level 1', async () => {
    const question = (await golden()).find(
      (g) => g.expect.level === 5 && g.query.subject,
    ) as Golden;
    const first = await vault.recall(question.query);
    expect(first).toMatchObject({ status: 'found', level: 5, writeback: { written: true } });
    const page = first.writeback?.path as string;
    expect(await read(root, `${page}.md`)).toContain(
      `« ${first.writeback?.line} » (relevé dans [[`,
    );
    expect(await read(root, `${page}.md`)).toContain(`- ${first.writeback?.ref}`);
    const again = await vault.recall(question.query);
    expect(again).toMatchObject({ status: 'found', level: 1 });
    expect(again.hits[0]).toMatchObject({ path: page, line: expect.stringContaining('IBAN') });
    expect(await read(root, 'log.md')).toContain(`réponse retenue · agent:recall · ${page}`);
  });

  it('asks a person about what it did not find, found twice, or found in a mail nobody filed', async () => {
    const questions = await golden();
    for (const g of questions.filter((x) => x.expect.level >= 5 && !x.query.subject)) {
      await vault.recall(g.query);
    }
    const missing = questions.find((g) => g.expect.status === 'not_found') as Golden;
    expect(await vault.recall(missing.query)).toMatchObject({ status: 'not_found', level: 6 });
    const twin = questions.find((g) => g.expect.status === 'ambiguous') as Golden;
    expect(await vault.recall(twin.query)).toMatchObject({ status: 'ambiguous' });
    const open = await read(root, 'open-questions.md');
    expect(open).toContain(`n'a rien trouvé pour « ${missing.query.question} »`);
    expect(open).toMatch(/Le document \[\[raw\/2026\/10\/acces-depot\.eml\]\] répond à/);
    expect(open).toMatch(/Ces pages ne disent pas la même chose .* · bloque une action/);
    const [logged] = await database.db.select({ n: count() }).from(memoryRecalls);
    expect(logged?.n).toBeGreaterThanOrEqual(5);
  });
});
