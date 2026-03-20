/**
 * E2E browser journey: Admin portal — Beta Access Manager
 *
 * Steps:
 *   1. Unauthenticated /admin redirects to /login
 *   2. Non-admin user sees denied/error state on /admin
 *   3. Admin link visible in navbar for admin user
 *   4. "Beta Access Manager" heading loads on /admin
 *   5. User search returns results with BETA/ADMIN badges
 *   6. Grant beta access → success banner + participant in list
 *   7. Participant list shows email, status badge, start/expiry dates
 *   8. Extend beta → success banner
 *   9. Revoke beta → success banner
 *  10. Invoice → success banner with invoice ID
 *
 * All /api/admin/* calls are intercepted by the `adminRoutes` fixture so
 * the journey is fully deterministic with no running backend.
 *
 * Bug policy: soft assertions + issueFor() log GitHub issues and continue
 * execution; afterEach logs the full failure body if the test fails.
 */

import { adminTest as test, expect, ADMIN_RESPONSES, MOCK_INVOICE_ID } from './fixtures/guesty';
import { logGitHubIssue } from './github-issue';

const ADMIN_USER    = { id: 'admin-001', email: 'admin@example.com', is_admin: true,  is_demo: false, is_beta: false };
const REGULAR_USER  = { id: 'user-001',  email: 'user@example.com',  is_admin: false, is_demo: false, is_beta: false };

async function issueFor(
  info: { title: string; file: string },
  action: string,
  expected: string,
  actual: string,
) {
  const title = `[Admin UI] ${info.title} — ${action}`;
  const body  = [
    `**Test**: ${info.title}`,
    `**File**: ${info.file}`,
    `**Action**: ${action}`,
    `**Expected**: ${expected}`,
    `**Actual**: ${actual}`,
  ].join('\n');
  await logGitHubIssue(title, body).catch((e: Error) => console.warn('[github-issue]', e.message));
}

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== 'failed') return;
  const title = `[Admin UI] ${testInfo.title}`;
  const body  = testInfo.errors.map((e) => [
    `**Test**: ${testInfo.title}`,
    `**File**: ${testInfo.file}`,
    `**Duration**: ${testInfo.duration}ms`,
    `\`\`\`\n${e.message ?? String(e)}\n\`\`\``,
  ].join('\n')).join('\n\n');
  await logGitHubIssue(title, body).catch((e: Error) => console.warn('[github-issue]', e.message));
});

test(
  'Admin portal journey: auth guards → Beta Access Manager → search → grant → extend → revoke → invoice',
  async ({ page, adminRoutes: _ }, info) => {

  // ── Step 1: Unauthenticated /admin redirects to /login ───────────────────
  await test.step('unauthenticated redirect', async () => {
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    });

    await page.goto('/admin');

    await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10_000 });

    const url = page.url();
    if (!url.includes('/login')) {
      await issueFor(info, 'unauthenticated redirect', 'URL redirects to /login', url);
    }
    expect.soft(page.url(), 'unauthenticated /admin redirects to /login').toContain('/login');
  });

  // ── Step 2: Non-admin user sees denied/error state ────────────────────────
  await test.step('non-admin access denied', async () => {
    await page.evaluate((user) => {
      localStorage.setItem('token', 'mock-regular-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, REGULAR_USER);

    await page.route('**/api/admin/beta', (r) =>
      r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Admin access required' }) })
    );

    await page.goto('/admin');

    const adminLink = page.locator('a[href="/admin"], a:has-text("Admin")');
    const adminLinkVisible = await adminLink.isVisible().catch(() => false);
    if (adminLinkVisible) {
      await issueFor(info, 'non-admin navbar', 'Admin link hidden for non-admin users', 'Admin link is visible');
    }
    expect.soft(adminLinkVisible, 'Admin nav link is hidden for non-admin users').toBe(false);

    const errorBanner = page.locator('text=Admin access required, text=access denied, text=403').first();
    const errorOrHeading = page.locator(':text("Admin access required"), :text("denied"), .bg-red-50').first();
    await errorOrHeading.waitFor({ timeout: 8_000 }).catch(() => {});
    const errorVisible = await errorOrHeading.isVisible().catch(() => false);
    if (!errorVisible) {
      await issueFor(
        info,
        'non-admin /admin renders',
        'error banner or access denied shown for non-admin user',
        'no error/denied state visible — non-admin may be able to view admin page',
      );
    }
    expect.soft(errorVisible, 'non-admin user sees error/denied state on /admin').toBe(true);

    await page.unroute('**/api/admin/beta');
  });

  // ── Step 3: Admin user sees Admin link in navbar ──────────────────────────
  await test.step('admin navbar link', async () => {
    await page.evaluate((user) => {
      localStorage.setItem('token', 'mock-admin-token');
      localStorage.setItem('user', JSON.stringify(user));
    }, ADMIN_USER);

    await page.goto('/');

    const adminNavLink = page.locator('a[href="/admin"]').first();
    await adminNavLink.waitFor({ timeout: 8_000 }).catch(() => {});
    const visible = await adminNavLink.isVisible().catch(() => false);
    if (!visible) {
      await issueFor(info, 'admin navbar link', 'Admin link visible in navbar for admin user', 'Admin link not found in navbar');
    }
    expect.soft(visible, 'Admin link is visible in navbar for admin user').toBe(true);
  });

  // ── Step 4: Admin portal loads with "Beta Access Manager" heading ─────────
  await test.step('admin portal heading', async () => {
    await page.goto('/admin');

    const heading = page.locator('h1:has-text("Beta Access Manager")');
    await heading.waitFor({ timeout: 10_000 }).catch(async () => {
      await issueFor(info, 'admin portal heading', '"Beta Access Manager" h1 visible', 'heading not found or timed out');
    });

    const visible = await heading.isVisible().catch(() => false);
    if (!visible) {
      await issueFor(info, 'admin portal heading', '"Beta Access Manager" h1 visible', 'heading not visible');
    }
    expect.soft(visible, '"Beta Access Manager" heading is visible on /admin').toBe(true);

    const searchCard = page.locator('h2:has-text("Search Users")');
    expect.soft(await searchCard.isVisible().catch(() => false), '"Search Users" card visible').toBe(true);

    const grantCard = page.locator('h2:has-text("Grant Beta Access")');
    expect.soft(await grantCard.isVisible().catch(() => false), '"Grant Beta Access" card visible').toBe(true);
  });

  // ── Step 5: User search → results with BETA/ADMIN badges ─────────────────
  await test.step('user search', async () => {
    const searchInput = page.locator('input[placeholder*="email"], input[placeholder*="Search"]').first();
    await searchInput.waitFor({ timeout: 5_000 });
    await searchInput.fill('beta');

    const searchBtn = page.locator('button:has-text("Search")');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/users/search'), { timeout: 10_000 }),
      searchBtn.click(),
    ]);

    const body = await resp.json().catch(() => null);
    if (!body?.users || !Array.isArray(body.users)) {
      await issueFor(info, 'user search response', '{ users: [...] }', JSON.stringify(body));
    }
    expect.soft(body?.users, 'user search returns users array').toBeTruthy();

    const betaBadge = page.locator('text=BETA').first();
    await betaBadge.waitFor({ timeout: 5_000 }).catch(() => {});
    expect.soft(
      await betaBadge.isVisible().catch(() => false),
      'BETA badge visible in search results',
    ).toBe(true);

    const adminBadge = page.locator('text=ADMIN').first();
    expect.soft(
      await adminBadge.isVisible().catch(() => false),
      'ADMIN badge visible in search results',
    ).toBe(true);
  });

  // ── Step 6: Grant beta access → success banner ────────────────────────────
  await test.step('grant beta access', async () => {
    const emailInput = page.locator('input[placeholder*="user@example.com"]').first();
    await emailInput.waitFor({ timeout: 5_000 });
    await emailInput.fill('newbeta@example.com');

    const expiryInputs = page.locator('input[type="date"]');
    const expiryInput  = expiryInputs.nth(1);
    await expiryInput.fill('2027-12-31');

    const grantBtn = page.locator('button:has-text("Grant Beta Access")');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/beta/grant'), { timeout: 10_000 }),
      grantBtn.click(),
    ]);

    const body = await resp.json().catch(() => null);
    if (!body?.success) {
      await issueFor(info, 'grant beta response', '{ success: true }', JSON.stringify(body));
    }
    expect.soft(body?.success, 'grant beta API returns success: true').toBe(true);

    const successBanner = page.locator('.bg-emerald-50, [class*="emerald"]').filter({ hasText: 'Beta access granted' }).first();
    await successBanner.waitFor({ timeout: 8_000 }).catch(() => {});
    expect.soft(
      await successBanner.isVisible().catch(() => false),
      'success banner shown after granting beta access',
    ).toBe(true);

    // After grant, fetchParticipants() re-runs → participant list re-renders.
    // The fixture always returns the same mock participant (beta@example.com),
    // so we verify the list still shows a participant after the grant action.
    const participantList = page.locator('h2:has-text("Beta Participants")');
    await participantList.waitFor({ timeout: 8_000 }).catch(() => {});
    const listVisible = await participantList.isVisible().catch(() => false);
    if (!listVisible) {
      await issueFor(info, 'grant → participant list', '"Beta Participants" section visible after grant', '"Beta Participants" heading not found');
    }
    expect.soft(listVisible, '"Beta Participants" section visible after grant').toBe(true);
  });

  // ── Step 7: Participants list — email, status badge, start/expiry dates ───
  await test.step('participants list', async () => {
    const participant = ADMIN_RESPONSES.betaParticipants.participants[0];

    const emailCell = page.locator(`text=${participant.email}`).first();
    await emailCell.waitFor({ timeout: 8_000 }).catch(async () => {
      await issueFor(info, 'participants list email', `"${participant.email}" visible in list`, 'email not found in participants list');
    });
    expect.soft(
      await emailCell.isVisible().catch(() => false),
      `participant email "${participant.email}" visible in list`,
    ).toBe(true);

    const statusBadge = page.locator('text=active').first();
    expect.soft(
      await statusBadge.isVisible().catch(() => false),
      'status badge (active) visible for participant',
    ).toBe(true);

    // Start / Expires date labels are always rendered (value may be "—" if null)
    const startLabel  = page.locator('span.text-slate-400:has-text("Start")').first();
    const expiresLabel = page.locator('span.text-slate-400:has-text("Expires")').first();
    expect.soft(
      await startLabel.isVisible().catch(() => false),
      '"Start" date label visible in participant row',
    ).toBe(true);
    expect.soft(
      await expiresLabel.isVisible().catch(() => false),
      '"Expires" date label visible in participant row',
    ).toBe(true);

    // The mock has non-null dates — formatted date text should appear
    const startDate   = new Date(participant.beta_starts_at!).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const expiresDate = new Date(participant.beta_expires_at!).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const startDateEl   = page.locator(`text=${startDate}`).first();
    const expiresDateEl = page.locator(`text=${expiresDate}`).first();
    if (!(await startDateEl.isVisible().catch(() => false))) {
      await issueFor(info, 'participant start date', `start date "${startDate}" visible`, 'start date text not found in participant row');
    }
    expect.soft(
      await startDateEl.isVisible().catch(() => false),
      `formatted start date "${startDate}" visible in participant row`,
    ).toBe(true);
    expect.soft(
      await expiresDateEl.isVisible().catch(() => false),
      `formatted expiry date "${expiresDate}" visible in participant row`,
    ).toBe(true);

    const extendBtn = page.locator('button:has-text("Extend")').first();
    expect.soft(
      await extendBtn.isVisible().catch(() => false),
      '"Extend" action button visible for active participant',
    ).toBe(true);

    const revokeBtn = page.locator('button:has-text("Revoke")').first();
    expect.soft(
      await revokeBtn.isVisible().catch(() => false),
      '"Revoke" action button visible for active participant',
    ).toBe(true);

    const invoiceBtn = page.locator('button:has-text("Invoice")').first();
    expect.soft(
      await invoiceBtn.isVisible().catch(() => false),
      '"Invoice" action button visible for participant',
    ).toBe(true);
  });

  // ── Step 8: Extend beta ───────────────────────────────────────────────────
  await test.step('extend beta', async () => {
    const successBannerDismiss = page.locator('button:has-text("Dismiss")').first();
    await successBannerDismiss.click().catch(() => {});

    const extendToggle = page.locator('button:has-text("Extend")').first();
    await extendToggle.click();

    const extendDateInput = page.locator('.bg-amber-50 input[type="date"]').first();
    await extendDateInput.waitFor({ timeout: 5_000 }).catch(async () => {
      await issueFor(info, 'extend form', 'extend date input visible after clicking Extend', 'extend date input not found');
    });
    await extendDateInput.fill('2028-06-30');

    const extendSubmit = page.locator('.bg-amber-50 button:has-text("Extend")').first();
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/extend'), { timeout: 10_000 }),
      extendSubmit.click(),
    ]);

    const body = await resp.json().catch(() => null);
    if (!body?.success) {
      await issueFor(info, 'extend beta response', '{ success: true }', JSON.stringify(body));
    }
    expect.soft(body?.success, 'extend beta API returns success: true').toBe(true);

    const successBanner = page.locator('.bg-emerald-50, [class*="emerald"]').filter({ hasText: 'Beta access extended' }).first();
    await successBanner.waitFor({ timeout: 8_000 }).catch(() => {});
    expect.soft(
      await successBanner.isVisible().catch(() => false),
      'success banner shown after extending beta',
    ).toBe(true);
  });

  // ── Step 9: Revoke beta ───────────────────────────────────────────────────
  await test.step('revoke beta', async () => {
    const successBannerDismiss = page.locator('button:has-text("Dismiss")').first();
    await successBannerDismiss.click().catch(() => {});

    const revokeBtn = page.locator('button:has-text("Revoke")').first();
    await revokeBtn.waitFor({ timeout: 5_000 });

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/revoke'), { timeout: 10_000 }),
      revokeBtn.click(),
    ]);

    const body = await resp.json().catch(() => null);
    if (!body?.success) {
      await issueFor(info, 'revoke beta response', '{ success: true }', JSON.stringify(body));
    }
    expect.soft(body?.success, 'revoke beta API returns success: true').toBe(true);

    const successBanner = page.locator('.bg-emerald-50, [class*="emerald"]').filter({ hasText: 'Beta access revoked' }).first();
    await successBanner.waitFor({ timeout: 8_000 }).catch(() => {});
    expect.soft(
      await successBanner.isVisible().catch(() => false),
      'success banner shown after revoking beta',
    ).toBe(true);
  });

  // ── Step 10: Invoice ──────────────────────────────────────────────────────
  await test.step('create invoice', async () => {
    const successBannerDismiss = page.locator('button:has-text("Dismiss")').first();
    await successBannerDismiss.click().catch(() => {});

    const invoiceToggle = page.locator('button:has-text("Invoice")').first();
    await invoiceToggle.waitFor({ timeout: 5_000 });
    await invoiceToggle.click();

    const descInput = page.locator('.bg-purple-50 input[placeholder*="GuestyMigrate"]').first();
    await descInput.waitFor({ timeout: 5_000 }).catch(async () => {
      await issueFor(info, 'invoice form', 'invoice description input visible after clicking Invoice', 'invoice form not found');
    });
    await descInput.fill('Beta Program — Q1 2026');

    const amountInput = page.locator('.bg-purple-50 input[type="number"]').first();
    await amountInput.fill('500');

    const sendBtn = page.locator('button:has-text("Send Invoice")').first();
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/invoice'), { timeout: 10_000 }),
      sendBtn.click(),
    ]);

    const body = await resp.json().catch(() => null);
    if (!body?.success) {
      await issueFor(info, 'create invoice response', '{ success: true, invoiceId: string }', JSON.stringify(body));
    }
    expect.soft(body?.success, 'invoice API returns success: true').toBe(true);
    expect.soft(body?.invoiceId, 'invoice API returns invoiceId').toBeTruthy();

    const expectedText = `Invoice created and sent (${MOCK_INVOICE_ID})`;
    const successBanner = page.locator('.bg-emerald-50, [class*="emerald"]').filter({ hasText: MOCK_INVOICE_ID }).first();
    await successBanner.waitFor({ timeout: 8_000 }).catch(() => {});
    const visible = await successBanner.isVisible().catch(() => false);
    if (!visible) {
      await issueFor(info, 'invoice success toast', `success banner containing "${MOCK_INVOICE_ID}"`, 'success banner not found or missing invoice ID');
    }
    expect.soft(visible, `success banner with invoice ID "${MOCK_INVOICE_ID}" visible after invoice creation`).toBe(true);
  });
});
