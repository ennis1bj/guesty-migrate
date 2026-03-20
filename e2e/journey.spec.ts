/**
 * E2E browser journey: signup → Guesty credentials → migration execution.
 *
 * Uses the `test` from e2e/fixtures/guesty.ts which registers page.route()
 * handlers for all Guesty endpoint families before each test runs.
 * The globalSetup HTTP mock server (port 4999) intercepts backend→Guesty
 * calls at the transport level when the app is started with GUESTY_BASE_URL.
 *
 * Bug policy: assertion failures are logged as GitHub issues via afterEach.
 */

import { test, expect } from './fixtures/guesty';
import { logGitHubIssue } from './github-issue';

const EMAIL    = `pw-${Date.now()}@e2e.test`;
const PASSWORD = 'SecurePass123!';

test.afterEach(async ({ }, info) => {
  if (info.status !== 'failed') return;
  const title = `[E2E] ${info.title}`;
  const body  = info.errors.map((e) => `\`\`\`\n${e.message ?? String(e)}\n\`\`\``).join('\n');
  await logGitHubIssue(title, body).catch((err: Error) => console.warn('[github-issue]', err.message));
});

test('Full migration journey: register → credentials → manifest → migration → completion', async ({ page, guestyRoutes: _ }) => {
  // ── Step 1: Register ───────────────────────────────────────────────────────
  await test.step('register', async () => {
    await page.goto('/register');

    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();

    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirmPassword').fill(PASSWORD);
    await page.locator('input[type="checkbox"]').first().check();

    const submit = page.locator('button[type="submit"]');
    await expect(submit).toBeEnabled();

    await Promise.all([
      page.waitForURL((url) => !url.pathname.endsWith('/register'), { timeout: 20_000 }),
      submit.click(),
    ]);

    expect(page.url()).not.toContain('/register');
  });

  // ── Step 2: Credentials form ───────────────────────────────────────────────
  await test.step('credentials form', async () => {
    await page.goto('/migrate');

    // Active step "Credentials" has border-amber-500 on its circle (StepWizard)
    const step1Li = page.locator('li').filter({ hasText: 'Credentials' });
    await expect(step1Li).toBeVisible();
    await expect(step1Li.locator('div.border-amber-500').first()).toBeVisible();

    // Fill source and destination credentials
    await page.locator('input[placeholder="Source Client ID"]').fill('src-client-id-test');
    await page.locator('input[placeholder="Source Client Secret"]').fill('src-secret-test');
    await page.locator('input[placeholder="Destination Client ID"]').fill('dst-client-id-test');
    await page.locator('input[placeholder="Destination Client Secret"]').fill('dst-secret-test');

    // Channel-disconnect confirmation checkbox is required for submit
    const channelCheckbox = page.locator('input[type="checkbox"]').last();
    await expect(channelCheckbox).toBeVisible();
    await channelCheckbox.check();

    const connectBtn = page.getByRole('button', { name: /connect.*analyz/i });
    await expect(connectBtn).toBeEnabled();
    await connectBtn.click();

    // Wait for step 2 to appear
    await expect(page.getByText('Source Account Data')).toBeVisible({ timeout: 25_000 });

    // Review step must now have active indicator
    const step2Li = page.locator('li').filter({ hasText: 'Review' });
    await expect(step2Li.locator('div.border-amber-500').first()).toBeVisible();
  });

  // ── Step 3: Manifest review & demo-activate ────────────────────────────────
  await test.step('manifest review and demo-activate', async () => {
    // Listings category card must show count 2 (from Guesty mock)
    const listingsCard = page.locator('button').filter({ hasText: /listings/i });
    await expect(listingsCard).toBeVisible({ timeout: 10_000 });
    await expect(listingsCard.locator('p.text-amber-500')).toHaveText('2');

    // At least one more category card present (fees)
    await expect(page.locator('button').filter({ hasText: /fees/i })).toBeVisible();

    // Demo badge is shown for is_demo users
    await expect(page.getByText(/demo account.*payment bypassed/i)).toBeVisible();

    // Click demo-activate and capture the 200 response
    const demoBtn = page.getByRole('button', { name: /start migration.*demo/i });
    await expect(demoBtn).toBeVisible();

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/demo-activate') && r.status() === 200, { timeout: 25_000 }),
      demoBtn.click(),
    ]);
    const body = await resp.json().catch(() => null);
    expect(body?.success).toBe(true);

    // Progress step becomes active
    await expect(page.getByText('Migration Progress')).toBeVisible({ timeout: 15_000 });
    const step4Li = page.locator('li').filter({ hasText: 'Progress' });
    await expect(step4Li.locator('div.border-amber-500').first()).toBeVisible();
  });

  // ── Step 4: Progress view ──────────────────────────────────────────────────
  await test.step('progress view and completion', async () => {
    // Status badge must eventually show a terminal state
    await expect(page.getByText(/^complete$|^complete_with_errors$|^failed$/i).first())
      .toBeVisible({ timeout: 60_000 });

    // Per-category ProgressBar log rows must be visible (label + percentage)
    // ProgressBar renders `label.replace(/_/g, ' ')` → "listings", "custom fields", etc.
    const logSection = page.locator('div.mb-8').filter({ has: page.locator('.mb-4') });
    await expect(logSection).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('listings', { exact: false })).toBeVisible();
    await expect(page.getByText('custom fields', { exact: false })).toBeVisible();
    await expect(page.getByText(/\d+%/).first()).toBeVisible();
  });
});
