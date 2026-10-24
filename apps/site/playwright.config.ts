import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4333',
    launchOptions: { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx scripts/serve-demo.ts',
    url: 'http://127.0.0.1:4333',
    reuseExistingServer: !process.env.CI,
  },
});
