import { loadServerEnv } from '@fi/shared/env';
import { serve } from '@hono/node-server';
import { createApp } from './app';

const env = loadServerEnv();

serve({ fetch: createApp().fetch, port: env.MOCK_PDP_PORT }, (info) => {
  console.log(`mock-pdp listening on http://localhost:${info.port}`);
});
