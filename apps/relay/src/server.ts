// `pnpm relay`: the relay from .env (docs/RUNBOOK.md § The relay). Its own database, never the API's:
// RELAY_DATABASE_URL, else PGlite in RELAY_PGLITE_DIR.

import { openDatabase } from '@fi/db';
import { loadServerEnv } from '@fi/shared/env';
import { serve } from '@hono/node-server';
import { createRelay } from './app';
import { telegramApi } from './telegram';

const env = loadServerEnv();
const missing = (
  ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET'] as const
).filter((key) => !env[key]);
if (missing.length > 0) throw new Error(`the relay needs ${missing.join(', ')}`);
const token = env.TELEGRAM_BOT_TOKEN ?? '';

const database = await openDatabase(
  env.RELAY_DATABASE_URL ? { url: env.RELAY_DATABASE_URL } : { dir: env.RELAY_PGLITE_DIR },
);
await database.migrate();
const log = (message: string) => console.warn(message);
const relay = createRelay({
  db: database.db,
  telegram: telegramApi({ url: env.TELEGRAM_API_URL, token }),
  ...(env.RELAY_ADMIN_TOKEN && { adminToken: env.RELAY_ADMIN_TOKEN }),
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? '',
  botUsername: env.TELEGRAM_BOT_USERNAME ?? '',
  log,
});
const purge = () =>
  relay.purge().catch((e) => log(`relay: purge: ${e instanceof Error ? e.message : String(e)}`));
await purge();
setInterval(purge, 3_600_000).unref();

// Behind the operator's TLS proxy (Telegram calls an https address): listens on this machine.
serve({ fetch: relay.app.fetch, port: env.RELAY_PORT, hostname: '127.0.0.1' }, (info) =>
  console.log(`relay listening on http://127.0.0.1:${info.port}`),
);
