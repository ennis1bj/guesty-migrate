/**
 * E2E Browser Journey: signup → configure Guesty API credentials → execute migration
 *
 * Architecture:
 *  - The full React + Express stack must be running before this suite executes
 *    (started externally with GUESTY_BASE_URL / GUESTY_AUTH_URL env vars).
 *  - Guesty Open API calls are intercepted by the local HTTP mock server started
 *    in e2e/globalSetup.ts (e2e/fixtures/guesty.ts).  Endpoint families mirror the
 *    exact paths used by server/guestyClient.js.
 *  - No /api/* routes are mocked; all backend calls go through the real Express
 *    server and the real PostgreSQL database.
 *
 * Bug policy: assertion failures are reported as GitHub issues via afterEach.
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import { logGitHubIssue } from './github-issue';

const TEST_EMAIL = `pw-${Date.now()}@e2e.test`;
const TEST_PASSWORD = 'SecurePass123!';

let page!: Page;
let context!: BrowserContext;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  try { await context?.close(); } catch { /* ignore */ }
});

/**
 * Log a GitHub issue for every failing test (best-effort).
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
    testInfo.errors.map((e) => `\`\`\`\n${e.message ?? String(e)}\n\`\`\``).join('\n'),
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

  // ── Required form fields ──────────────────────────────────────────────────
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('#confirmPassword')).toBeVisible();

  // ── Fill and submit ───────────────────────────────────────────────────────
  await page.locator('#email').fill(TEST_EMAIL);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.locator('#confirmPassword').fill(TEST_PASSWORD);

  // Terms checkbox (first on the page)
  const termsCheckbox = page.locator('input[type="checkbox"]').first();
  await expect(termsCheckbox).toBeVisible();
  await termsCheckbox.check();

  const submitBtn = page.locator('button[type="submit"]');
  await expect(submitBtn).toBeEnabled();

  // Backend creates user with is_demo=true when NODE_ENV=test
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 20_000 }),
    submitBtn.click(),
  ]);

  expect(page.url()).not.toContain('/register');
});

test('Step 2 — Navigate to /migrate: step 1 (Credentials) is active; fill and submit credentials form', async () => {
  await page.goto('/migrate');

  // ── Step wizard: "Credentials" step must be visually active ──────────────
  // Active step circle has border-amber-500 class (from StepWizard component).
  const step1Li = page.locator('li').filter({ hasText: /^Credentials/ });
  await expect(step1Li).toBeVisible();
  // The active circle has text-amber-600 (unique to the current step)
  const activeCircle = step1Li.locator('div.border-amber-500');
  await expect(activeCircle).toBeVisible();

  // ── Credentials inputs ────────────────────────────────────────────────────
  const srcClientId = page.locator('input[placeholder="Source Client ID"]');
  const srcSecret   = page.locator('input[placeholder="Source Client Secret"]');
  const dstClientId = page.locator('input[placeholder="Destination Client ID"]');
  const dstSecret   = page.locator('input[placeholder="Destination Client Secret"]');

  await expect(srcClientId).toBeVisible();
  await srcClientId.fill('src-client-id-test');
  await srcSecret.fill('src-client-secret-test');
  await dstClientId.fill('dst-client-id-test');
  await dstSecret.fill('dst-client-secret-test');

  // ── Channel-disconnect confirmation checkbox (required for form submit) ────
  // The Migrate page shows a "Before you begin" checkbox tied to channelConfirmed state.
  // Without it, the "Connect & Analyze" button stays disabled.
  const channelCheckbox = page.locator('input[type="checkbox"]').filter({ hasNot: page.locator('[type="hidden"]') }).last();
  await expect(channelCheckbox).toBeVisible();
  await channelCheckbox.check();

  // ── Connect & Analyze button must now be enabled ──────────────────────────
  const connectBtn = page.getByRole('button', { name: /connect.*analyz/i });
  await expect(connectBtn).toBeEnabled();

  // Submit preflight → real backend calls the Guesty mock server
  await connectBtn.click();

  // ── Step wizard advances to step 2 "Review" ───────────────────────────────
  await expect(page.getByText('Source Account Data')).toBeVisible({ timeout: 25_000 });

  const step2Li = page.locator('li').filter({ hasText: /^Review/ });
  await expect(step2Li).toBeVisible();
  // Step 1 is now completed (bg-amber-500 filled circle); step 2 is active
  const step2ActiveCircle = step2Li.locator('div.border-amber-500');
  await expect(step2ActiveCircle).toBeVisible();
});

test('Step 3 — Manifest review: category cards show correct counts; demo-activate triggers migration', async () => {
  // ── Manifest cards: "listings" category must show count 2 ─────────────────
  // ManifestCard renders each category as a <button> with the category name
  // and a <p class="text-2xl font-extrabold text-amber-500"> showing the count.
  const listingsCard = page.locator('button').filter({ hasText: /listings/i });
  await expect(listingsCard).toBeVisible({ timeout: 10_000 });

  const listingsCount = listingsCard.locator('p.text-amber-500');
  await expect(listingsCount).toHaveText('2', { timeout: 5_000 });

  // At least one more category card should be present (custom fields, fees, taxes, etc.)
  const feesCard = page.locator('button').filter({ hasText: /fees/i });
  await expect(feesCard).toBeVisible();

  // ── Pricing block should appear for demo users ────────────────────────────
  // Demo users see "Demo account — payment bypassed" badge instead of pay button
  const demoBadge = page.getByText(/demo account.*payment bypassed/i);
  await expect(demoBadge).toBeVisible({ timeout: 10_000 });

  // ── Demo activation ───────────────────────────────────────────────────────
  const demoBtn = page.getByRole('button', { name: /start migration.*demo/i });
  await expect(demoBtn).toBeVisible();

  const [demoActivateResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/demo-activate') && r.status() === 200,
      { timeout: 25_000 },
    ),
    demoBtn.click(),
  ]);

  const respJson = await demoActivateResp.json().catch(() => null);
  expect(respJson?.success).toBe(true);

  // ── Step wizard advances to step 4 "Progress" ─────────────────────────────
  await expect(page.getByText('Migration Progress')).toBeVisible({ timeout: 15_000 });

  const step4Li = page.locator('li').filter({ hasText: /^Progress/ });
  await expect(step4Li).toBeVisible();
  const step4ActiveCircle = step4Li.locator('div.border-amber-500');
  await expect(step4ActiveCircle).toBeVisible();
});

test('Step 4 — Progress view: status badge appears; category ProgressBar rows render after completion', async () => {
  // ── Status badge must eventually show a terminal state ────────────────────
  // The badge text is exactly the status string (complete | complete_with_errors | failed)
  await expect(page.getByText(/^complete$|^complete_with_errors$|^failed$/i).first())
    .toBeVisible({ timeout: 60_000 });

  // ── Per-category ProgressBar rows must be rendered ────────────────────────
  // ProgressBar renders a label text using `label.replace(/_/g, ' ')` and a
  // percentage text like "50%" or "100%".
  const listingsBarLabel = page.getByText('listings', { exact: false });
  await expect(listingsBarLabel).toBeVisible({ timeout: 15_000 });

  const customFieldsBarLabel = page.getByText('custom fields', { exact: false });
  await expect(customFieldsBarLabel).toBeVisible({ timeout: 10_000 });

  // At least one progress percentage should be shown
  const percentLabel = page.getByText(/\d+%/).first();
  await expect(percentLabel).toBeVisible({ timeout: 10_000 });
});
