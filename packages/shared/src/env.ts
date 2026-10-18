import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Node-only: import from '@fi/shared/env', never from the add-in bundle.

export const FiEnv = z.enum(['local', 'sandbox', 'prod']);
export type FiEnv = z.infer<typeof FiEnv>;

/** The repository root: relative paths in .env are read from here, whatever the process cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);
/** `KEY=` in .env means "not set". */
const blank = (value: unknown) => (value === '' ? undefined : value);
const optionalText = (min = 1) => z.preprocess(blank, z.string().min(min).optional());
const flag = (fallback: boolean) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? !['false', '0', 'no', 'off'].includes(v.toLowerCase()) : v),
    z.boolean().default(fallback),
  );

export const ServerEnvSchema = z
  .object({
    FI_ENV: FiEnv.default('local'),
    API_PORT: port(4000),
    MOCK_PDP_PORT: port(4010),
    DATABASE_URL: optionalText(),
    PGLITE_DIR: z.string().default('.data/pglite'),
    ADMIN_TOKEN: optionalText(24),
    API_WORKERS: flag(true),
    PDP_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(300),
    MOCK_PDP_URL: z.url().default('http://localhost:4010'),
    MOCK_PDP_WEBHOOK_URL: z.preprocess(blank, z.url().optional()),
    MOCK_PDP_WEBHOOK_SECRET: z.string().min(16).default('local-mock-pdp-webhook-secret'),
    MOCK_PDP_SPEED: z.coerce.number().positive().default(86_400),
  })
  .superRefine((env, ctx) => {
    if (env.FI_ENV === 'local') return;
    for (const key of ['DATABASE_URL', 'ADMIN_TOKEN'] as const) {
      if (!env[key])
        ctx.addIssue({ code: 'custom', path: [key], message: `required in ${env.FI_ENV}` });
    }
  })
  .transform((env) => ({
    ...env,
    PGLITE_DIR: isAbsolute(env.PGLITE_DIR) ? env.PGLITE_DIR : resolve(REPO_ROOT, env.PGLITE_DIR),
  }));
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

const ROOT_ENV_FILE = resolve(REPO_ROOT, '.env');

/** Loads the repo-root .env if present (already-set variables win), then validates. */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (source === process.env && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return ServerEnvSchema.parse(source);
}
