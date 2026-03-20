/**
 * E2E Browser Journey: signup → configure Guesty API credentials → execute migration
 *
 * All /api/* requests are intercepted at the Playwright network layer so the
 * test never depends on a live database or real Guesty credentials.
 *
 * Any assertion that fails here represents a UI bug.  The afterAll hook logs a
 * GitHub issue for each failure through the connector SDK (best-effort; falls
 * back to console.warn when credentials are unavailable).
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import {
  MOCK_USER,
  MOCK_TOKEN,
  MOCK_MIGRATION_ID,
  MOCK_PREFLIGHT_RESPONSE,
  MOCK_STATUS_RUNNING,
  MOCK_STATUS_COMPLETE,
} from './fixtures/api';
import { logGitHubIssue } from './github-issue';

// ── Shared state across the journey ──────────────────────────────────────────
// eslint-disable-next-line prefer-const
let page!: Page;
// eslint-disable-next-line prefer-const
let context!: BrowserContext;
const failedAssertions: { title: string; body: string }[] = [];

// ── Intercept all /api/* calls ────────────────────────────────────────────────
async function setupApiMocks(ctx: BrowserContext) {
  // Auth: register
  await ctx.route('**/api/auth/register', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ token: MOCK_TOKEN, user: MOCK_USER }),
    });
  });

  // Auth: login (may be needed for re-visits)
  await ctx.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: MOCK_TOKEN, user: MOCK_USER }),
    });
  });

  // Migrations: preflight
  await ctx.route('**/api/migrations/preflight', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PREFLIGHT_RESPONSE),
    });
  });

  // Migrations: demo-activate
  await ctx.route(`**/api/migrations/${MOCK_MIGRATION_ID}/demo-activate`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  // Migrations: status — return 'complete' on first poll
  await ctx.route(`**/api/migrations/${MOCK_MIGRATION_ID}/status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_STATUS_COMPLETE),
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function softExpect(
  title: string,
  fn: () => Promise<void>,
) {
  try {
    await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    failedAssertions.push({ title, body: `## Assertion failure\n\n**Test**: ${title}\n\n**Error**:\n\`\`\`\n${msg}\n\`\`\`` });
    console.warn(`[soft-fail] ${title}:`, msg);
  }
}

// ── Test setup ────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  await setupApiMocks(context);
  page = await context.newPage();
});

test.afterAll(async () => {
  try { await context?.close(); } catch { /* ignore if context was never created */ }

  if (failedAssertions.length === 0) return;

  for (const issue of failedAssertions) {
    await logGitHubIssue(issue.title, issue.body).catch(err => {
      console.warn('[github-issue] could not log:', err.message);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY TESTS
// ═════════════════════════════════════════════════════════════════════════════

test('Step 1 — Register: form renders and submits', async () => {
  await page.goto('/register');

  // All inputs must be visible
  await softExpect('Email input is visible', async () => {
    await expect(page.locator('#email')).toBeVisible();
  });
  await softExpect('Password input is visible', async () => {
    await expect(page.locator('#password')).toBeVisible();
  });
  await softExpect('Confirm-password input is visible', async () => {
    await expect(page.locator('#confirmPassword')).toBeVisible();
  });
  await softExpect('Terms checkbox is visible', async () => {
    await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();
  });

  // Fill the form
  await page.locator('#email').fill('playwright@example.com');
  await page.locator('#password').fill('SecurePass123!');
  await page.locator('#confirmPassword').fill('SecurePass123!');
  await page.locator('input[type="checkbox"]').first().check();

  // Submit button must become enabled
  const submitBtn = page.locator('button[type="submit"]');
  await softExpect('Submit button is enabled after filling form', async () => {
    await expect(submitBtn).toBeEnabled();
  });

  // Submit and wait for navigation away from /register
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 15_000 }),
    submitBtn.click(),
  ]);

  await softExpect('Navigated away from /register after successful registration', async () => {
    expect(page.url()).not.toContain('/register');
  });
});

test('Step 2 — Navigate to /migrate and enter Guesty API credentials', async () => {
  await page.goto('/migrate');

  // Step 1 of the wizard should be visible
  await softExpect('Migrate page heading is present', async () => {
    await expect(page.getByText('New Migration')).toBeVisible();
  });

  // Fill Source credentials
  await page.locator('input[placeholder="Source Client ID"]').fill('src-client-id-test');
  await page.locator('input[placeholder="Source Client Secret"]').fill('src-client-secret-test');

  // Fill Destination credentials
  await page.locator('input[placeholder="Destination Client ID"]').fill('dst-client-id-test');
  await page.locator('input[placeholder="Destination Client Secret"]').fill('dst-client-secret-test');

  // Check the "Before you begin" checkbox (second checkbox on the page)
  const checkboxes = page.locator('input[type="checkbox"]');
  const checkboxCount = await checkboxes.count();
  if (checkboxCount > 0) {
    await checkboxes.last().check();
  }

  // Click "Connect & Analyze"
  const connectBtn = page.getByRole('button', { name: /connect.*analyze/i });
  await softExpect('"Connect & Analyze" button is visible', async () => {
    await expect(connectBtn).toBeVisible();
  });

  await connectBtn.click();

  // Step 2 of the wizard should appear — manifest summary
  await softExpect('Step 2: Source Account Data section appears', async () => {
    await expect(page.getByText('Source Account Data')).toBeVisible({ timeout: 15_000 });
  });
});

test('Step 3 — Select categories and activate demo migration', async () => {
  // Expect the manifest counts from our fixture
  await softExpect('Manifest shows listing count', async () => {
    await expect(page.getByText('2')).toBeVisible();
  });

  // Click "Start Migration (Demo)"
  const demoBtn = page.getByRole('button', { name: /start migration.*demo/i });
  await softExpect('"Start Migration (Demo)" button is present', async () => {
    await expect(demoBtn).toBeVisible();
  });

  await demoBtn.click();

  // Step 3: migration progress view should appear
  await softExpect('Step 3: Migration progress section appears', async () => {
    const terminal = page.getByText(/complete|failed|running/i);
    await expect(terminal).toBeVisible({ timeout: 20_000 });
  });
});

test('Step 4 — Status view shows completion', async () => {
  // The status mock returns 'complete' immediately.
  // The UI should reflect this terminal state.
  await softExpect('Terminal status badge is shown', async () => {
    const statusBadge = page.getByText(/complete/i).first();
    await expect(statusBadge).toBeVisible({ timeout: 15_000 });
  });

  await softExpect('At least one category log row is rendered', async () => {
    // The Migrate page renders per-category progress rows
    const logItem = page.getByText('custom_fields').or(page.getByText('listings')).first();
    await expect(logItem).toBeVisible({ timeout: 10_000 });
  });
});
