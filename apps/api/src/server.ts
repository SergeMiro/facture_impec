import { loadServerEnv } from '@fi/shared/env';
import { logLine } from './log';
import { startApi } from './runtime';

const env = loadServerEnv();
const api = await startApi({ env });
logLine(
  'info',
  `api (${env.FI_ENV}) listening on ${api.url} — ${api.database.kind}, workers ${env.API_WORKERS ? 'on' : 'off'}`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void api.close().then(() => process.exit(0));
  });
}
