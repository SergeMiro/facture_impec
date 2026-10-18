import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// M3 switches the dev server to HTTPS (office-addin-dev-certs) for sideloading into Excel.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      port: Number(env.ADDIN_PORT ?? 3000),
      strictPort: true,
    },
  };
});
