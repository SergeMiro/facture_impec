import { loadServerEnv } from '@fi/shared/env';
import { startApi } from './runtime';

const env = loadServerEnv();
const api = await startApi({ env });
console.log(
  `api (${env.FI_ENV}) listening on ${api.url} — ${api.database.kind}, workers ${env.API_WORKERS ? 'on' : 'off'}`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void api.close().then(() => process.exit(0));
  });
}
