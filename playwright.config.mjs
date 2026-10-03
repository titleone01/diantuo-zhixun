import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '*.spec.mjs', workers: 1, fullyParallel: false,
  retries: 0, timeout: 60000, expect: { timeout: 10000 }, maxFailures: 3,
  reporter: [['./e2e/sanitized-reporter.mjs']],
  outputDir: process.env.DIANTUO_BROWSER_PRIVATE_OUTPUT,
  use: { browserName: 'chromium', baseURL: process.env.DIANTUO_TEST_URL, viewport: { width: 1700, height: 1100 }, trace: 'off', screenshot: 'off', video: 'off' },
});
