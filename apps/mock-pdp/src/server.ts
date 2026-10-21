import { loadServerEnv } from '@fi/shared/env';
import { createMockPdp } from './app';
import { listen } from './listen';

const env = loadServerEnv();

const { app } = createMockPdp({
  speed: env.MOCK_PDP_SPEED,
  webhookSecret: env.MOCK_PDP_WEBHOOK_SECRET,
  ...(env.MOCK_PDP_WEBHOOK_URL && { webhookUrl: env.MOCK_PDP_WEBHOOK_URL }),
  log: (message) => console.warn(message),
  b2brouter: {
    ...(env.MOCK_PDP_B2BROUTER_WEBHOOK_URL && { webhookUrl: env.MOCK_PDP_B2BROUTER_WEBHOOK_URL }),
    ...(env.B2BROUTER_WEBHOOK_SECRET && { webhookSecret: env.B2BROUTER_WEBHOOK_SECRET }),
  },
  stripe: {
    webhookSecret: env.MOCK_STRIPE_WEBHOOK_SECRET,
    publicUrl: new URL('/stripe', env.MOCK_PDP_URL).toString(),
    ...(env.MOCK_STRIPE_WEBHOOK_URL && { webhookUrl: env.MOCK_STRIPE_WEBHOOK_URL }),
  },
  microsoft: { publicUrl: new URL('/microsoft', env.MOCK_PDP_URL).toString() },
});

const server = await listen(app.fetch, env.MOCK_PDP_PORT);
console.log(
  `mock-pdp listening on ${server.url} (×${env.MOCK_PDP_SPEED}, webhooks ${env.MOCK_PDP_WEBHOOK_URL ?? 'off'}, B2Brouter stand-in at /b2brouter, webhooks ${env.MOCK_PDP_B2BROUTER_WEBHOOK_URL ?? 'off'}; Stripe stand-in at /stripe, webhooks ${env.MOCK_STRIPE_WEBHOOK_URL ?? 'off'}; company directory at /sirene; Microsoft stand-in at /microsoft)`,
);
