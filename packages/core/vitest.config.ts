// Two projects: `unit` runs offline in under a second; `oracle` checks the generated XML against
// the official XSD and schematrons (test/oracle/), fetching the files it may not commit first.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.oracle.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'oracle',
          include: ['test/**/*.oracle.test.ts'],
          globalSetup: ['test/oracle/setup.ts'],
          // A cold run compiles three stylesheets (about 45 s) before the first test.
          hookTimeout: 300_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
