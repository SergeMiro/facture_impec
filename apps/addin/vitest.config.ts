import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __API_URL__: JSON.stringify('/api') },
  // controller.test.ts runs the real API on PGlite: slower than a unit test under load.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
