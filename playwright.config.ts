import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for GuestyMigrate E2E browser tests.
 *
 * ## Running the browser E2E suite locally
 *
 * 1. Start the Guesty mock server + dev stack with the mock URL injected:
 *
 *    GUESTY_BASE_URL=http://127.0.0.1:4999 \
 *    GUESTY_AUTH_URL=http://127.0.0.1:4999 \
 *    NODE_ENV=test npm run dev
 *
 * 2. Run Playwright (in a second terminal):
 *
 *    npm run test:e2e
 *
 * The `globalSetup` hook automatically starts the Guesty mock HTTP server on
 * port 4999 before any test runs, and `globalTeardown` stops it afterwards.
 * The test suite requires the dev server to already be running — it does NOT
 * start one itself (`reuseExistingServer: true`).
 */

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 1,

  globalSetup: './e2e/globalSetup.ts',
  globalTeardown: './e2e/globalTeardown.ts',

  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      },
    },
  ],

  /**
   * Require a pre-running dev server on port 5000.
   * reuseExistingServer: true — never auto-start; fail fast if the server is
   * not up.  Start it with the GUESTY env vars as described above.
   */
  webServer: {
    command: 'echo "Dev server must be started manually with GUESTY_BASE_URL env vars — see playwright.config.ts"',
    url: 'http://localhost:5000',
    reuseExistingServer: true,
  },
});
