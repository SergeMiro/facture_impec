// One schema, two drivers: node-postgres when DATABASE_URL is set (sandbox, prod, a local Docker
// Postgres), PGlite otherwise (Postgres 17 compiled to WASM, in-process: dev without Docker, and
// every test). Both run the same migrations and the same queries.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import type { SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** The connection or the transaction a query runs on. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/** Raw SQL rows: both drivers answer `{ rows }`, which the shared Db type leaves untyped. */
export async function rows<T>(db: DbOrTx, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

export const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

interface Common {
  db: Db;
  /** Applies the drizzle/ migrations that have not run yet. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}
export type Database =
  | (Common & { kind: 'postgres'; url: string })
  | (Common & { kind: 'pglite'; pglite: PGlite });

export interface OpenOptions {
  /** postgres:// URL; wins over PGlite. */
  url?: string;
  /** PGlite data directory; omitted = in memory. */
  dir?: string;
}

export async function openDatabase(options: OpenOptions = {}): Promise<Database> {
  const config = { migrationsFolder: MIGRATIONS };
  if (options.url) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: options.url });
    const db = drizzle(pool, { schema });
    return {
      kind: 'postgres',
      db,
      url: options.url,
      migrate: () => migrate(db, config),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (options.dir) mkdirSync(options.dir, { recursive: true });
  const pglite = new PGlite(options.dir);
  const db = drizzle(pglite, { schema });
  return {
    kind: 'pglite',
    db,
    pglite,
    migrate: () => migrate(db, config),
    close: () => pglite.close(),
  };
}
