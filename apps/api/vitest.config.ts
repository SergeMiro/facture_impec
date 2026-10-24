import { defineConfig } from 'vitest/config';

export default defineConfig({
  // src/test-setup.ts keeps the API's JSON log lines out of the test output (FI_TEST_LOGS=1 shows them).
  test: { include: ['src/**/*.test.ts'], setupFiles: ['./src/test-setup.ts'] },
});
