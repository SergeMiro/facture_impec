import { loadServerEnv } from '@fi/shared/env';
import { serve } from '@hono/node-server';
import { createApp } from './app';

const env = loadServerEnv();

serve({ fetch: createApp(env).fetch, port: env.API_PORT }, (info) => {
  console.log(`api (${env.FI_ENV}) listening on http://localhost:${info.port}`);
});
