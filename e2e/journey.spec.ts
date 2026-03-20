/**
 * E2E browser journey: register → credentials → manifest review →
 * payment (demo) → migration progress.
 *
 * All backend /api/* and Guesty Open API calls are intercepted by the
 * `guestyRoutes` fixture (page.route() handlers) so the test is fully
 * deterministic with no running backend, database, or real Guesty
 * credentials required.
 *
 * Bug policy: soft assertions log GitHub issues and continue execution
 * so all journey stages are tested in a single run.  The overall test
 * is still marked failed when any soft assertion fails.
 */

import { test, expect, API_RESPONSES } from './fixtures/guesty';
import { logGitHubIssue } from './github-issue';

const EMAIL    = `pw-${Date.now()}@e2e.test`;
const PASSWORD = 'SecurePass123!';

async function issueFor(info: { title: string; file: string }, action: string, expected: string, actual: string) {
  const title = `[E2E browser] ${info.title} — ${action}`;
  const body  = [
    `**Test**: ${info.title}`,
    `**File**: ${info.file}`,
    `**Action**: ${action}`,
    `**Expected**: ${expected}`,
    `**Actual**: ${actual}`,
  ].join('\n');
  await logGitHubIssue(title, body).catch((e: Error) => console.warn('[github-issue]', e.message));
}

test.afterEach(async ({ }, info) => {
  if (info.status !== 'failed') return;
  const title = `[E2E browser] ${info.title}`;
  const body  = info.errors.map((e) => [
    `**Test**: ${info.title}`,
    `**File**: ${info.file}`,
    `**Duration**: ${info.duration}ms`,
    `\`\`\`\n${e.message ?? String(e)}\n\`\`\``,
  ].join('\n')).join('\n\n');
  await logGitHubIssue(title, body).catch((e: Error) => console.warn('[github-issue]', e.message));
});

test(
  'Full migration journey: register → credentials → manifest → payment → progress',
  async ({ page, guestyRoutes: _ }, info) => {

  // ── Step 1: Register ─────────────────────────────────────────────────────
  await test.step('register', async () => {
    await page.goto('/register');

    await expect.soft(page.locator('#email'), 'email input visible').toBeVisible();
    await expect.soft(page.locator('#password'), 'password input visible').toBeVisible();
    await expect.soft(page.locator('#confirmPassword'), 'confirm-password input visible').toBeVisible();

    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirmPassword').fill(PASSWORD);
    await page.locator('input[type="checkbox"]').first().check();

    const submit = page.locator('button[type="submit"]');
    await expect.soft(submit, 'submit button enabled after form fill').toBeEnabled();

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/register'), { timeout: 10_000 }),
      submit.click(),
    ]);
    const respBody = await resp.json().catch(() => null);
    if (!respBody?.token) {
      await issueFor(info, 'register API response', '{ token: string }', JSON.stringify(respBody));
    }
    expect.soft(respBody?.token, 'register response contains JWT token').toBeTruthy();

    // Navigate away from /register after successful auth
    await page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 15_000 });
    if (page.url().includes('/register')) {
      await issueFor(info, 'post-register navigation', 'URL leaves /register', page.url());
    }
    expect.soft(page.url(), 'navigated away from /register').not.toContain('/register');
  });

  // ── Step 2: Credentials form (step 0 in wizard) ──────────────────────────
  await test.step('credentials form', async () => {
    await page.goto('/migrate');

    // Credentials step circle should be active (border-amber-500)
    const step0Circle = page.locator('li').filter({ hasText: 'Credentials' }).locator('div.border-amber-500').first();
    await expect.soft(step0Circle, 'step 0 (Credentials) active circle visible').toBeVisible();

    await page.locator('input[placeholder="Source Client ID"]').fill('src-client-id-test');
    await page.locator('input[placeholder="Source Client Secret"]').fill('src-secret-test');
    await page.locator('input[placeholder="Destination Client ID"]').fill('dst-client-id-test');
    await page.locator('input[placeholder="Destination Client Secret"]').fill('dst-secret-test');

    // Channel-disconnect checkbox must be checked before "Connect & Analyze" activates
    const channelCheckbox = page.locator('input[type="checkbox"]').last();
    await expect.soft(channelCheckbox, 'channel-disconnect checkbox visible').toBeVisible();
    await channelCheckbox.check();

    const connectBtn = page.getByRole('button', { name: /connect.*analyz/i });
    await expect.soft(connectBtn, 'Connect & Analyze button enabled').toBeEnabled();

    const [preflightResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/migrations/preflight'), { timeout: 15_000 }),
      connectBtn.click(),
    ]);
    const preflightBody = await preflightResp.json().catch(() => null);
    if (preflightBody?.migrationId !== API_RESPONSES.preflight.migrationId) {
      await issueFor(info, 'preflight migrationId', API_RESPONSES.preflight.migrationId, preflightBody?.migrationId ?? '(missing)');
    }
    expect.soft(preflightBody?.migrationId, 'preflight returns migrationId').toBeTruthy();
  });

  // ── Step 3: Manifest review (step 1 in wizard) ───────────────────────────
  await test.step('manifest review', async () => {
    // "Source Account Data" heading confirms step 1 is active
    const sourceHeading = page.getByText('Source Account Data');
    if (!(await sourceHeading.isVisible({ timeout: 20_000 }).catch(() => false))) {
      await issueFor(info, 'manifest review heading', '"Source Account Data" visible', 'not visible within 20s');
    }
    await expect.soft(sourceHeading, '"Source Account Data" heading visible').toBeVisible({ timeout: 20_000 });

    // Review step circle active
    const step1Circle = page.locator('li').filter({ hasText: 'Review' }).locator('div.border-amber-500').first();
    await expect.soft(step1Circle, 'step 1 (Review) active circle visible').toBeVisible();

    // Listings manifest card: count must be 2 (from API_RESPONSES.preflight.manifest.listings)
    const listingsCard  = page.locator('button').filter({ hasText: /listings/i });
    const listingsCount = listingsCard.locator('p.text-amber-500');
    await expect.soft(listingsCard, 'listings manifest card visible').toBeVisible({ timeout: 10_000 });
    const countText = await listingsCount.textContent({ timeout: 5_000 }).catch(() => null);
    if (countText !== String(API_RESPONSES.preflight.manifest.listings)) {
      await issueFor(info, 'listings manifest count', String(API_RESPONSES.preflight.manifest.listings), countText ?? '(not found)');
    }
    await expect.soft(listingsCount, 'listings count equals 2').toHaveText(String(API_RESPONSES.preflight.manifest.listings));

    // Pricing section visible in manifest review (bottom of step 1 card)
    const pricingSection = page.getByText('Migration Price');
    await expect.soft(pricingSection, '"Migration Price" label visible').toBeVisible();

    // Pricing tier label visible (e.g. "starter tier — 2 listings")
    const tierText = page.getByText(new RegExp(API_RESPONSES.preflight.pricing.tier, 'i'));
    await expect.soft(tierText, `pricing tier "${API_RESPONSES.preflight.pricing.tier}" visible`).toBeVisible();

    // "Continue to Payment" button enabled (requires at least one category selected)
    const continueBtn = page.getByRole('button', { name: /continue to payment/i });
    await expect.soft(continueBtn, '"Continue to Payment" button visible').toBeVisible();
    await expect.soft(continueBtn, '"Continue to Payment" button enabled').toBeEnabled();
    await continueBtn.click();
  });

  // ── Step 4: Payment (step 2 in wizard) — demo path ──────────────────────
  await test.step('payment step — demo activation', async () => {
    // "Choose Your Pricing" heading confirms step 2 is active
    const paymentHeading = page.getByText('Choose Your Pricing');
    if (!(await paymentHeading.isVisible({ timeout: 15_000 }).catch(() => false))) {
      await issueFor(info, 'payment heading', '"Choose Your Pricing" visible', 'not visible within 15s');
    }
    await expect.soft(paymentHeading, '"Choose Your Pricing" heading visible').toBeVisible({ timeout: 15_000 });

    // Payment step circle active
    const step2Circle = page.locator('li').filter({ hasText: 'Payment' }).locator('div.border-amber-500').first();
    await expect.soft(step2Circle, 'step 2 (Payment) active circle visible').toBeVisible();

    // Pricing mode options visible
    await expect.soft(page.getByText('Flat Rate'), '"Flat Rate" pricing option visible').toBeVisible();
    await expect.soft(page.getByText('Per Listing'), '"Per Listing" pricing option visible').toBeVisible();

    // Order Summary section visible
    const orderSummary = page.getByText('Order Summary');
    await expect.soft(orderSummary, '"Order Summary" section visible').toBeVisible();

    // Demo account badge (only visible when is_demo=true)
    const demoBadge = page.getByText('Demo account — payment bypassed');
    if (!(await demoBadge.isVisible({ timeout: 10_000 }).catch(() => false))) {
      await issueFor(info, 'demo account badge', '"Demo account — payment bypassed" visible', 'not visible');
    }
    await expect.soft(demoBadge, '"Demo account — payment bypassed" badge visible').toBeVisible({ timeout: 10_000 });

    // "Start Migration (Demo)" button present and enabled
    const demoBtn = page.getByRole('button', { name: /start migration \(demo\)/i });
    await expect.soft(demoBtn, '"Start Migration (Demo)" button visible').toBeVisible();
    await expect.soft(demoBtn, '"Start Migration (Demo)" button enabled').toBeEnabled();

    const [demoResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/demo-activate'), { timeout: 15_000 }),
      demoBtn.click(),
    ]);
    const demoBody = await demoResp.json().catch(() => null);
    if (demoBody?.success !== true) {
      await issueFor(info, 'demo-activate response', '{ success: true }', JSON.stringify(demoBody));
    }
    expect.soft(demoBody?.success, 'demo-activate returns success=true').toBe(true);
  });

  // ── Step 5: Migration progress (step 3 in wizard) ────────────────────────
  await test.step('migration progress and log table', async () => {
    // "Migration Progress" heading confirms step 3 is active
    const progressHeading = page.getByText('Migration Progress');
    if (!(await progressHeading.isVisible({ timeout: 20_000 }).catch(() => false))) {
      await issueFor(info, 'migration progress heading', '"Migration Progress" visible', 'not visible within 20s');
    }
    await expect.soft(progressHeading, '"Migration Progress" heading visible').toBeVisible({ timeout: 20_000 });

    // Progress step circle active
    const step3Circle = page.locator('li').filter({ hasText: 'Progress' }).locator('div.border-amber-500').first();
    await expect.soft(step3Circle, 'step 3 (Progress) active circle visible').toBeVisible();

    // Status badge eventually shows a terminal state
    const terminalBadge = page.getByText(/^complete$|^complete_with_errors$|^failed$/i).first();
    if (!(await terminalBadge.isVisible({ timeout: 30_000 }).catch(() => false))) {
      await issueFor(info, 'terminal status badge', 'complete|complete_with_errors|failed badge', 'not visible within 30s');
    }
    await expect.soft(terminalBadge, 'terminal status badge visible').toBeVisible({ timeout: 30_000 });

    // Log table: ProgressBar container (div.mb-8) holds per-category rows
    const logTable = page.locator('div.mb-8').filter({ has: page.locator('div.mb-4') }).first();
    await expect.soft(logTable, 'log table (ProgressBar rows container) visible').toBeVisible({ timeout: 10_000 });

    // Per-category labels (ProgressBar renders label.replace(/_/g, ' '))
    await expect.soft(page.getByText('listings',      { exact: false }), '"listings" log row label visible').toBeVisible();
    await expect.soft(page.getByText('custom fields', { exact: false }), '"custom fields" log row label visible').toBeVisible();

    // Percentage text rendered by ProgressBar
    await expect.soft(page.getByText(/\d+%/).first(), 'percentage text visible in log row').toBeVisible();
  });
});
