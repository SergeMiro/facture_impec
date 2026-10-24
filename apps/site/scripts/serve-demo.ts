// Foreground local server for the website's own browser tests.

import { fileURLToPath } from 'node:url';
import { dev } from 'astro';

const server = await dev({
  root: fileURLToPath(new URL('../', import.meta.url)),
  devToolbar: { enabled: false },
  vite: { cacheDir: fileURLToPath(new URL('../node_modules/.vite-demo/', import.meta.url)) },
  server: { host: '127.0.0.1', port: 4333 },
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void server.stop().then(() => process.exit(0));
  });
