import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { generateCertificates } from 'office-addin-dev-certs';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The localhost certificate Office requires (docs/OFFICE.md §6), in the folder
 * `npx office-addin-dev-certs install` uses. Missing or expired: generated here, without installing
 * the CA (that step needs sudo); the browser then asks to accept it once (docs/RUNBOOK.md § Add-in).
 */
async function devCertificate() {
  const dir = join(homedir(), '.office-addin-dev-certs');
  const cert = join(dir, 'localhost.crt');
  const key = join(dir, 'localhost.key');
  const valid =
    existsSync(cert) &&
    existsSync(key) &&
    Date.parse(new X509Certificate(readFileSync(cert)).validTo) > Date.now() + 86_400_000;
  if (!valid) await generateCertificates(join(dir, 'ca.crt'), cert, key, 30);
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const https = command === 'serve' && !process.env.VITEST ? await devCertificate() : undefined;
  const apiPort = env.API_PORT || '4000';
  const port = Number(env.ADDIN_PORT || 3000);
  return {
    plugins: [react()],
    envDir: repoRoot,
    define: { __API_URL__: JSON.stringify(env.ADDIN_API_URL || '/api') },
    server: {
      port,
      strictPort: true,
      https,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
      },
    },
    preview: { port, strictPort: true, https },
    build: {
      // harness.html is a dev page: only the task pane ships.
      rolldownOptions: { input: fileURLToPath(new URL('./taskpane.html', import.meta.url)) },
    },
  };
});
