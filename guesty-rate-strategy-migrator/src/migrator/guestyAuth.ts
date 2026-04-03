import { type BrowserContext, type Page } from '@playwright/test';
import { logger } from '../utils/logger';

// ── Error types ───────────────────────────────────────────────────────────────

export class LoginFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginFailedError';
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GUESTY_APP_URL = process.env.GUESTY_APP_URL ?? 'https://app.guesty.com';
const DEFAULT_TIMEOUT = Number(process.env.BROWSER_TIMEOUT_MS ?? 15_000);

// ── Auth flow ─────────────────────────────────────────────────────────────────

/**
 * Logs into a Guesty account using Playwright browser automation.
 *
 * Navigates to the Guesty login page, fills email and password, clicks submit,
 * then waits for the URL to navigate away from /login. Throws LoginFailedError
 * if authentication fails (wrong credentials, 2FA prompt, account locked, etc.).
 *
 * SECURITY: The email and password parameters are never logged.
 *
 * @param context - An isolated BrowserContext for this job.
 * @param credentials - { email, password } — never stored or logged.
 * @returns The authenticated Playwright Page object.
 */
export async function loginToGuesty(
  context: BrowserContext,
  credentials: { email: string; password: string }
): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  logger.info('Navigating to Guesty login page');
  await page.goto(`${GUESTY_APP_URL}/login`, { waitUntil: 'domcontentloaded' });

  // ── Fill email ──────────────────────────────────────────────────────────────
  const emailInput = page
    .getByLabel(/email/i)
    .or(page.locator('input[type="email"]'))
    .first();
  await emailInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await emailInput.fill(credentials.email);

  // ── Fill password ───────────────────────────────────────────────────────────
  const passwordInput = page
    .getByLabel(/password/i)
    .or(page.locator('input[type="password"]'))
    .first();
  await passwordInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await passwordInput.fill(credentials.password);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const submitButton = page.getByRole('button', { name: /sign in|log in|login/i });
  await submitButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await submitButton.click();

  // ── Wait for navigation away from /login ────────────────────────────────────
  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: DEFAULT_TIMEOUT,
    });
  } catch {
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Check for 2FA prompt before reporting a generic failure
      const has2FA = await page
        .getByText(/two-factor|2fa|verification code/i)
        .isVisible()
        .catch(() => false);

      if (has2FA) {
        throw new LoginFailedError(
          '2FA prompt detected — automated login is not supported when 2FA is enabled on this account'
        );
      }

      throw new LoginFailedError(
        `Login failed: browser is still on the login page after submit. URL: ${currentUrl}`
      );
    }
  }

  logger.info('Guesty login successful');
  return page;
}
