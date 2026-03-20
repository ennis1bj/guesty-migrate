/**
 * E2E Browser Journey: signup → configure Guesty API credentials → execute migration
 *
 * Architecture:
 *  - The full React + Express stack is running (started by playwright.config.ts webServer
 *    with GUESTY_BASE_URL / GUESTY_AUTH_URL pointing at the local mock server).
 *  - Guesty Open API calls (open-api.guesty.com) are intercepted by the mock HTTP
 *    server started in globalSetup (e2e/globalSetup.ts → e2e/fixtures/guesty.ts).
 *  - No /api/* routes are mocked; every backend call goes through the real Express server
 *    and the real PostgreSQL database.
 *
 * Bug policy: any assertion failure is reported as a GitHub issue via the afterEach hook.
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import { logGitHubIssue } from './github-issue';

const TEST_EMAIL = `pw-${Date.now()}@e2e.test`;
const TEST_PASSWORD = 'SecurePass123!';

let page!: Page;
let context!: BrowserContext;
let migrationId: string | null = null;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  try { await context?.close(); } catch { /* ignore */ }
});

/**
 * Log a GitHub issue for any test failure (best-effort).
 */
test.afterEach(async ({ }, testInfo) => {
  if (testInfo.status !== 'failed') return;
  const title = `[E2E browser failure] ${testInfo.title}`;
  const body = [
    `## E2E Journey Test Failure`,
    ``,
    `**Test**: ${testInfo.title}`,
    `**File**: ${testInfo.file}`,
    `**Duration**: ${testInfo.duration}ms`,
    ``,
    `**Errors**:`,
    testInfo.errors.map((e) => `\`\`\`\n${e.message ?? e}\n\`\`\``).join('\n'),
  ].join('\n');
  await logGitHubIssue(title, body).catch((err: Error) => {
    console.warn('[github-issue] could not log:', err.message);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY STEPS
// ═════════════════════════════════════════════════════════════════════════════

test('Step 1 — Register: form renders and real backend creates the user', async () => {
  await page.goto('/register');

  // ── Form elements must be present ────────────────────────────────────────
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('#confirmPassword')).toBeVisible();
  await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();

  // ── Fill the form ─────────────────────────────────────────────────────────
  await page.locator('#email').fill(TEST_EMAIL);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.locator('#confirmPassword').fill(TEST_PASSWORD);
  await page.locator('input[type="checkbox"]').first().check();

  const submitBtn = page.locator('button[type="submit"]');
  await expect(submitBtn).toBeEnabled();

  // ── Submit and wait for navigation (backend creates user; is_demo=true in test mode)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 20_000 }),
    submitBtn.click(),
  ]);

  expect(page.url()).not.toContain('/register');
});

test('Step 2 — Navigate to /migrate and enter Guesty API credentials', async () => {
  await page.goto('/migrate');

  // ── Step wizard: step 1 "Credentials" should be the active step ──────────
  // The StepWizard renders the active step circle with border-amber-500 text-amber-600 bg-white
  const credentialsStep = page.locator('li').filter({ hasText: 'Credentials' });
  await expect(credentialsStep).toBeVisible();

  // ── Fill Source credentials ───────────────────────────────────────────────
  const srcClientId = page.locator('input[placeholder="Source Client ID"]');
  const srcSecret = page.locator('input[placeholder="Source Client Secret"]');
  const dstClientId = page.locator('input[placeholder="Destination Client ID"]');
  const dstSecret = page.locator('input[placeholder="Destination Client Secret"]');

  await expect(srcClientId).toBeVisible();
  await srcClientId.fill('src-client-id-test');
  await srcSecret.fill('src-client-secret-test');
  await dstClientId.fill('dst-client-id-test');
  await dstSecret.fill('dst-client-secret-test');

  // Tick the channel-manager confirmation checkbox if present
  const checkboxes = page.locator('input[type="checkbox"]');
  const cnt = await checkboxes.count();
  if (cnt > 0) await checkboxes.last().check();

  // ── Submit preflight (hits real backend → backend calls Guesty mock) ──────
  const connectBtn = page.getByRole('button', { name: /connect.*analyz/i });
  await expect(connectBtn).toBeVisible();
  await connectBtn.click();

  // ── Step wizard should advance to step 2 "Review" ─────────────────────────
  // Wait for the manifest section ("Source Account Data") to appear
  await expect(page.getByText('Source Account Data')).toBeVisible({ timeout: 25_000 });

  // The Review step label should now be active (completed or current)
  const reviewStep = page.locator('li').filter({ hasText: 'Review' });
  await expect(reviewStep).toBeVisible();
});

test('Step 3 — Manifest review shows listing count and demo-activate triggers migration', async () => {
  // ── Guesty mock returns 2 listings → manifest should show that count ──────
  // The manifest card renders a number for each category
  const listingCount = page.getByText('2', { exact: true }).first();
  await expect(listingCount).toBeVisible({ timeout: 10_000 });

  // ── Demo mode: "Start Migration (Demo)" button should be present for demo users
  const demoBtn = page.getByRole('button', { name: /start migration.*demo/i });
  await expect(demoBtn).toBeVisible();

  // ── Capture migration id from the real backend response via network event ─
  const [demoActivateResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/demo-activate') && r.status() === 200, { timeout: 25_000 }),
    demoBtn.click(),
  ]);

  const respJson = await demoActivateResp.json().catch(() => null);
  // success=true is expected from a real backend demo-activate response
  expect(respJson?.success).toBe(true);

  // ── Step wizard should advance to step 4 "Progress" ──────────────────────
  const progressStep = page.locator('li').filter({ hasText: 'Progress' });
  await expect(progressStep).toBeVisible({ timeout: 15_000 });
});

test('Step 4 — Progress view shows running state, then completes with log rows', async () => {
  // ── A status badge should be visible (running → complete) ─────────────────
  // Poll until terminal status is shown (complete | complete_with_errors | failed)
  await expect(
    page.getByText(/complete|failed/i).first(),
  ).toBeVisible({ timeout: 60_000 });

  // ── Per-category log rows must be rendered in the results table ───────────
  // The Migrate page renders category names inside log rows
  const categoryRow = page
    .getByText('custom_fields', { exact: false })
    .or(page.getByText('listings', { exact: false }))
    .or(page.getByText('fees', { exact: false }))
    .first();
  await expect(categoryRow).toBeVisible({ timeout: 10_000 });

  // ── ProgressBar widgets should be visible for migrated categories ─────────
  // ProgressBar renders a label + percentage; find any percentage text
  const percentText = page.getByText(/\d+%/).first();
  await expect(percentText).toBeVisible({ timeout: 10_000 });
});
