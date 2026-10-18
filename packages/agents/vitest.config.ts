// Unit tests next to the code, plus evals/ (fixtures replayed through the agents, no network).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'evals/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-model.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
