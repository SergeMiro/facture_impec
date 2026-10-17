import type { FiEnv } from '@fi/shared/env';
import { Hono } from 'hono';

export function createApp(env: { FI_ENV: FiEnv }) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: 'api', env: env.FI_ENV }));

  return app;
}
