import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
});
