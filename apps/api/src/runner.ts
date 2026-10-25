// The runner (memory doc §5, docs/DECISIONS.md D12): this API started with VAULT_DIR, on the
// company's machine (mode A) or its server (mode B, deploy/runner/). The environment checks keep it
// on the machine and its database out of the vault (@fi/shared/env); here it takes the vault for as
// long as it runs (a second runner on the same vault does not start), serves one company, and dumps
// its database into the vault once a day, the last seven kept, so that a lost machine loses nothing
// the vault does not hold. Each night it also lints the vault and runs the memory's rules
// (src/rules.ts, memory M5). These daily tasks catch up after a stop like every other schedule
// (schedules.ts).
import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { parisToday } from '@fi/core';
import { type Database, isNull, openDatabase, tenants } from '@fi/db';
import { MemoryStore, MemoryVault } from '@fi/memory';
import type { ServerEnv } from '@fi/shared/env';
import { logLine } from './log';
import { invoiceSources } from './prepare';
import { LINT_HOUR, RULES_HOUR, runLint, runRules } from './rules';
import { dailyDue, lastRun, ran } from './schedules';

/** The dump runs once a day after this hour (Paris), when nobody works. */
export const DUMP_HOUR = 3;
export const DUMPS_KEPT = 7;
export const DUMPS_DIR = '_system/dumps';
const DUMP_FILE = /^base-\d{4}-\d{2}-\d{2}\.tar\.gz$/;
/** How often the runner looks whether its daily tasks are due. */
const CHECK_EVERY_MS = 15 * 60_000;

export interface Runner {
  vault: MemoryVault;
  /** Runs the daily tasks that are due (at start, then every 15 minutes). */
  catchUp(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The database as one file in the vault (PGlite's data folder as a gzipped tar), written whole or
 * not at all, the last seven kept. Returns the file's path in the vault.
 */
export async function dumpDatabase(database: Database, root: string, now: Date): Promise<string> {
  if (database.kind !== 'pglite') throw new Error('the runner dumps a PGlite database only');
  const dir = join(root, DUMPS_DIR);
  await mkdir(dir, { recursive: true });
  const name = `base-${parisToday(now)}.tar.gz`;
  const tmp = join(dir, `${name}.tmp-${randomBytes(6).toString('hex')}`);
  const bytes = new Uint8Array(await (await database.pglite.dumpDataDir('gzip')).arrayBuffer());
  const file = await open(tmp, 'w');
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(tmp, join(dir, name));
  const files = (await readdir(dir)).sort();
  const dumps = files.filter((f) => DUMP_FILE.test(f));
  const litter = files.filter((f) => f.includes('.tmp-'));
  for (const old of [...dumps.slice(0, -DUMPS_KEPT), ...litter]) await rm(join(dir, old));
  return `${DUMPS_DIR}/${name}`;
}

/**
 * Puts a dump back as the runner's database, into an empty data folder (the runner stopped;
 * docs/RUNBOOK.md § Runner). Returns the companies it holds.
 */
export async function restoreDump(file: string, dir: string): Promise<string[]> {
  const database = await openDatabase({ dir, restore: new Blob([await readFile(file)]) });
  try {
    await database.migrate();
    const companies = await database.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(isNull(tenants.deletedAt));
    return companies.map((c) => c.name);
  } finally {
    await database.close();
  }
}

/** Takes the vault when VAULT_DIR is set; null otherwise (the hosted API). */
export async function openRunner(options: {
  env: ServerEnv;
  database: Database;
  now: () => Date;
  log: (message: string) => void;
}): Promise<Runner | null> {
  const { env, database, now, log } = options;
  const root = env.VAULT_DIR;
  if (!root) return null;
  if (database.kind !== 'pglite') throw new Error('the runner keeps its database in PGLITE_DIR');
  const companies = await database.db
    .select({ id: tenants.id })
    .from(tenants)
    .where(isNull(tenants.deletedAt));
  if (companies.length > 1) {
    throw new Error(`a runner serves one company; its database holds ${companies.length}`);
  }
  // A company set up after the runner started gets its index at the next start (docs/DEFERRED.md).
  const store = companies[0] && new MemoryStore(database.db, companies[0].id);
  // An invoice a page names is looked up; the other sources are vouched by what wrote them.
  const vault = await MemoryVault.open(root, {
    host: hostname(),
    clock: now,
    ...(store && { store }),
    ...(companies[0] && { sourceExists: invoiceSources(database.db, companies[0].id) }),
  });

  // Each daily task once its hour has passed, one failing leaving the others to run: the lint
  // first (the night's questions), the dump, then the rules over what the night left.
  const daily = async (name: string, hour: number, task: (at: Date) => Promise<string>) => {
    try {
      if (!dailyDue((await lastRun(database.db, name))?.lastRunAt, now(), hour)) return;
      const at = now();
      const done = await task(at);
      await ran(database.db, name, at);
      logLine('info', `runner: ${done}`);
    } catch (e) {
      log(`runner: ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const company = companies[0]?.id;
  let running: Promise<void> | null = null;
  const catchUp = () => {
    running ??= (async () => {
      try {
        if (company) {
          await daily('lint', LINT_HOUR, async (at) => {
            const r = await runLint(database.db, vault, company, at);
            return `memory linted: ${r.found} found, ${r.opened} new, ${r.gone} gone, ${r.asked} asked`;
          });
        }
        await daily('dump', DUMP_HOUR, async (at) => {
          return `database dumped into ${await dumpDatabase(database, root, at)}`;
        });
        if (company) {
          await daily('rules', RULES_HOUR, async (at) => {
            const r = await runRules(database.db, company, at);
            if (r.failed.length > 0) log(`runner: rules failed: ${r.failed.join(' ')}`);
            return `rules: ${r.raised} raised, ${r.cooled} cooled, ${r.gone} gone`;
          });
        }
      } finally {
        running = null;
      }
    })();
    return running;
  };
  void catchUp();
  const timer = setInterval(catchUp, CHECK_EVERY_MS);
  timer.unref();
  return {
    vault,
    catchUp,
    async close() {
      clearInterval(timer);
      await running;
      await vault.close();
    },
  };
}
