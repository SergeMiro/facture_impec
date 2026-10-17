import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Node-only: import from '@fi/shared/env', never from the add-in bundle.

export const FiEnv = z.enum(['local', 'sandbox', 'prod']);
export type FiEnv = z.infer<typeof FiEnv>;

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

export const ServerEnvSchema = z.object({
  FI_ENV: FiEnv.default('local'),
  API_PORT: port(4000),
  MOCK_PDP_PORT: port(4010),
});
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/** Loads the repo-root .env if present (already-set variables win), then validates. */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (source === process.env && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return ServerEnvSchema.parse(source);
}
