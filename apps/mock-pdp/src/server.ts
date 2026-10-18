import { loadServerEnv } from '@fi/shared/env';
import { createMockPdp } from './app';
import { listen } from './listen';

const env = loadServerEnv();

const { app } = createMockPdp({
  speed: env.MOCK_PDP_SPEED,
  webhookSecret: env.MOCK_PDP_WEBHOOK_SECRET,
  ...(env.MOCK_PDP_WEBHOOK_URL && { webhookUrl: env.MOCK_PDP_WEBHOOK_URL }),
  log: (message) => console.warn(message),
});

const server = await listen(app.fetch, env.MOCK_PDP_PORT);
console.log(
  `mock-pdp listening on ${server.url} (×${env.MOCK_PDP_SPEED}, webhooks ${env.MOCK_PDP_WEBHOOK_URL ?? 'off'})`,
);
