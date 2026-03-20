import { defineConfig, devices } from '@playwright/test';

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
   * CI: starts the full dev stack with the Guesty mock URL injected via env vars.
   * globalSetup writes GUESTY_BASE_URL / GUESTY_AUTH_URL to process.env before
   * this command is executed, so the Express server picks them up automatically.
   *
   * Local Replit dev: reuseExistingServer=true reuses the running dev server.
   * For real backend E2E coverage locally, start the dev server with:
   *   GUESTY_BASE_URL=http://127.0.0.1:4999 GUESTY_AUTH_URL=http://127.0.0.1:4999 NODE_ENV=test npm run dev
   */
  webServer: {
    command: [
      'GUESTY_BASE_URL=http://127.0.0.1:4999',
      'GUESTY_AUTH_URL=http://127.0.0.1:4999',
      'NODE_ENV=test',
      'npm run dev',
    ].join(' '),
    url: 'http://localhost:5000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
