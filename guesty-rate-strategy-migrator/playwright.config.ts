// Set test-specific env vars before any test module is loaded.
// BROWSER_TIMEOUT_MS=3000 ensures the failure tests resolve in ~3 s
// instead of the production default of 15 s.
process.env.BROWSER_TIMEOUT_MS = process.env.BROWSER_TIMEOUT_MS ?? '3000';
process.env.GUESTY_APP_URL = process.env.GUESTY_APP_URL ?? 'https://mock.guesty.test';
process.env.PAYLOAD_ENCRYPTION_KEY =
  process.env.PAYLOAD_ENCRYPTION_KEY ?? 'a'.repeat(64);

import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

// When running in the Replit NixOS environment, use the system-provided
// Chromium binary from the Nix store (fully linked against NixOS libs).
// In Docker (production / CI), PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is unset
// so Playwright falls back to the bundled browser in the base image.
const NIX_CHROMIUM =
  '/nix/store/43y6k6fj85l4kcd1yan43hpdld6nmjmp-ungoogled-chromium-131.0.6778.204/bin/chromium';

export default defineConfig({
  testDir: './test',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    // Use the Nix Chromium when available; fall back to Playwright's bundled browser
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? NIX_CHROMIUM,
    },
  },
});
