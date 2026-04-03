// Set test-specific env vars before any test module is loaded.
// BROWSER_TIMEOUT_MS=3000 ensures the failure tests resolve in ~3 s
// instead of the production default of 15 s.
process.env.BROWSER_TIMEOUT_MS = process.env.BROWSER_TIMEOUT_MS ?? '3000';
process.env.GUESTY_APP_URL = process.env.GUESTY_APP_URL ?? 'https://mock.guesty.test';
process.env.PAYLOAD_ENCRYPTION_KEY =
  process.env.PAYLOAD_ENCRYPTION_KEY ?? 'a'.repeat(64);

import { defineConfig } from '@playwright/test';
import * as fs from 'fs';

// ── Chromium executable resolution ────────────────────────────────────────────
//
// Precedence (highest to lowest):
//   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var — set this in CI or Docker
//      to point at any Chromium-compatible binary.
//   2. NIX_CHROMIUM_PATH env var — convenience alias for Replit/NixOS.
//   3. Well-known Nix store path for ungoogled-chromium v131 (Replit default).
//   4. undefined — let Playwright use its own bundled browser (Docker base image
//      already has all system deps; bundled browser works there without --with-deps).
//
// This resolution order means:
//   • Docker / CI: do not set any override → bundled browser used automatically.
//   • Replit NixOS: auto-detected via the known store path (or override via env var).

const NIX_CHROMIUM_CANDIDATE =
  '/nix/store/43y6k6fj85l4kcd1yan43hpdld6nmjmp-ungoogled-chromium-131.0.6778.204/bin/chromium';

function resolveChromiumPath(): string | undefined {
  // Explicit env var takes highest priority
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  if (process.env.NIX_CHROMIUM_PATH) {
    return process.env.NIX_CHROMIUM_PATH;
  }
  // Fall back to the well-known Nix store path only if it exists on disk
  if (fs.existsSync(NIX_CHROMIUM_CANDIDATE)) {
    return NIX_CHROMIUM_CANDIDATE;
  }
  // Let Playwright use its bundled browser
  return undefined;
}

const chromiumPath = resolveChromiumPath();

export default defineConfig({
  testDir: './test',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
});
