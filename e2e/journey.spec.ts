/**
 * E2E browser journey: register → Guesty credentials → migration → completion.
 *
 * Uses page.route() handlers from e2e/fixtures/guesty.ts for all Guesty
 * endpoint families.  The globalSetup HTTP mock server intercepts backend→Guesty
 * calls when the app is started with GUESTY_BASE_URL=http://127.0.0.1:4999.
 *
 * Bug policy: soft assertions log GitHub issues and continue execution so all
 * steps run in one pass.  The test is still marked failed when any soft
 * assertion fails (Playwright reports accumulated soft-assertion failures at end).
 */

import { test, expect } from './fixtures/guesty';
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

test('Full migration journey: register → credentials → manifest → migration → completion', async ({ page, guestyRoutes: _ }, info) => {

  // ── Step 1: Register ───────────────────────────────────────────────────────
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
    await expect.soft(submit, 'submit button enabled after filling form').toBeEnabled();

    await Promise.all([
      page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 20_000 }),
      submit.click(),
    ]);

    if (page.url().includes('/register')) {
      await issueFor(info, 'post-register navigation', 'URL should not contain /register', page.url());
    }
    expect.soft(page.url(), 'navigated away from /register').not.toContain('/register');
  });

  // ── Step 2: Credentials form ───────────────────────────────────────────────
  await test.step('credentials form', async () => {
    await page.goto('/migrate');

    // StepWizard: active step circle has border-amber-500 class
    const step1Circle = page.locator('li').filter({ hasText: 'Credentials' }).locator('div.border-amber-500').first();
    if (!(await step1Circle.isVisible())) {
      await issueFor(info, 'step 1 active indicator', 'border-amber-500 circle visible on Credentials step', 'not visible');
    }
    await expect.soft(step1Circle, 'step 1 (Credentials) active circle visible').toBeVisible();

    await page.locator('input[placeholder="Source Client ID"]').fill('src-client-id-test');
    await page.locator('input[placeholder="Source Client Secret"]').fill('src-secret-test');
    await page.locator('input[placeholder="Destination Client ID"]').fill('dst-client-id-test');
    await page.locator('input[placeholder="Destination Client Secret"]').fill('dst-secret-test');

    // Channel-disconnect checkbox is required before "Connect & Analyze" enables
    const channelCheckbox = page.locator('input[type="checkbox"]').last();
    await expect.soft(channelCheckbox, 'channel-disconnect checkbox visible').toBeVisible();
    await channelCheckbox.check();

    const connectBtn = page.getByRole('button', { name: /connect.*analyz/i });
    await expect.soft(connectBtn, 'Connect & Analyze button enabled after checkbox').toBeEnabled();
    await connectBtn.click();

    // Source Account Data heading signals step 2 is active
    const sourceHeading = page.getByText('Source Account Data');
    if (!(await sourceHeading.isVisible({ timeout: 25_000 }).catch(() => false))) {
      await issueFor(info, 'preflight result', '"Source Account Data" heading visible', 'not visible within 25s');
    }
    await expect.soft(sourceHeading, '"Source Account Data" heading visible after preflight').toBeVisible({ timeout: 25_000 });

    // Review step active indicator
    const step2Circle = page.locator('li').filter({ hasText: 'Review' }).locator('div.border-amber-500').first();
    await expect.soft(step2Circle, 'step 2 (Review) active circle visible').toBeVisible();
  });

  // ── Step 3: Manifest review & demo-activate ────────────────────────────────
  await test.step('manifest review and demo-activate', async () => {
    // Listings manifest card: count must be 2
    const listingsCard  = page.locator('button').filter({ hasText: /listings/i });
    const listingsCount = listingsCard.locator('p.text-amber-500');
    await expect.soft(listingsCard, 'listings manifest card visible').toBeVisible({ timeout: 10_000 });

    const countText = await listingsCount.textContent({ timeout: 5_000 }).catch(() => null);
    if (countText !== '2') {
      await issueFor(info, 'listings manifest count', '2', countText ?? '(not found)');
    }
    await expect.soft(listingsCount, 'listings count equals 2').toHaveText('2');

    // At least one other category card (fees)
    await expect.soft(page.locator('button').filter({ hasText: /fees/i }), 'fees card visible').toBeVisible();

    // Demo badge
    const demoBadge = page.getByText(/demo account.*payment bypassed/i);
    await expect.soft(demoBadge, 'demo payment-bypassed badge visible').toBeVisible();

    // Demo-activate button
    const demoBtn = page.getByRole('button', { name: /start migration.*demo/i });
    await expect.soft(demoBtn, '"Start Migration (Demo)" button visible').toBeVisible();

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/demo-activate') && r.status() === 200, { timeout: 25_000 }),
      demoBtn.click(),
    ]);
    const respBody = await resp.json().catch(() => null);
    if (respBody?.success !== true) {
      await issueFor(info, 'demo-activate response', '{ success: true }', JSON.stringify(respBody));
    }
    expect.soft(respBody?.success, 'demo-activate response success=true').toBe(true);

    // Progress step active
    const progressHeading = page.getByText('Migration Progress');
    await expect.soft(progressHeading, '"Migration Progress" heading visible').toBeVisible({ timeout: 15_000 });

    const step4Circle = page.locator('li').filter({ hasText: 'Progress' }).locator('div.border-amber-500').first();
    await expect.soft(step4Circle, 'step 4 (Progress) active circle visible').toBeVisible();
  });

  // ── Step 4: Progress view ──────────────────────────────────────────────────
  await test.step('progress view and log table', async () => {
    // Status badge shows terminal state
    const terminalBadge = page.getByText(/^complete$|^complete_with_errors$|^failed$/i).first();
    if (!(await terminalBadge.isVisible({ timeout: 60_000 }).catch(() => false))) {
      await issueFor(info, 'terminal status badge', 'complete|complete_with_errors|failed badge visible', 'not visible within 60s');
    }
    await expect.soft(terminalBadge, 'terminal status badge visible').toBeVisible({ timeout: 60_000 });

    // Log table: ProgressBar container (div.mb-8) holds per-category rows
    const logTable = page.locator('div.mb-8').filter({ has: page.locator('div.mb-4') }).first();
    await expect.soft(logTable, 'log table (ProgressBar rows container) visible').toBeVisible({ timeout: 15_000 });

    // Category labels rendered by ProgressBar.label.replace(/_/g, ' ')
    await expect.soft(page.getByText('listings', { exact: false }), '"listings" log row label visible').toBeVisible();
    await expect.soft(page.getByText('custom fields', { exact: false }), '"custom fields" log row label visible').toBeVisible();

    // Percentage text (e.g. "100%") rendered by ProgressBar
    await expect.soft(page.getByText(/\d+%/).first(), 'percentage text visible in log row').toBeVisible();
  });
});
