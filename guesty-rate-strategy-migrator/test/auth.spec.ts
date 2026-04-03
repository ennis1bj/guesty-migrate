/**
 * Integration tests for guestyAuth.loginToGuesty()
 *
 * Uses Playwright's context.route() to mock the Guesty login page so no real
 * network access or credentials are required.
 *
 * Test cases:
 *   1. Successful login — form redirects to /dashboard (URL leaves /login)
 *   2. Failed login (wrong password) — form stays on /login → LoginFailedError
 *   3. 2FA detection — page shows "two-factor" text after submit → LoginFailedError
 *
 * The tests use `browser` fixture (injected by Playwright's test runner) so
 * the executablePath configured in playwright.config.ts is respected
 * automatically — no `chromium.launch()` calls needed.
 */

import { test, expect } from '@playwright/test';
import { loginToGuesty, LoginFailedError } from '../src/migrator/guestyAuth';

const MOCK_BASE = 'https://mock.guesty.test';

const loginForm = (action: string) => `
  <!DOCTYPE html>
  <html>
    <head><title>Guesty Login</title></head>
    <body>
      <form action="${action}" method="GET">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" />
        <label for="password">Password</label>
        <input id="password" type="password" name="password" />
        <button type="submit">Sign in</button>
      </form>
    </body>
  </html>
`;

const dashboardPage = `
  <!DOCTYPE html>
  <html><body><h1>Dashboard</h1></body></html>
`;

const twoFactorPage = `
  <!DOCTYPE html>
  <html>
    <body>
      <form>
        <p>two-factor authentication required</p>
        <input type="text" name="code" />
        <button type="submit">Verify</button>
      </form>
    </body>
  </html>
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('loginToGuesty()', () => {
  test('returns authenticated page when login redirects away from /login', async ({ browser }) => {
    const context = await browser.newContext();

    await context.route(/mock\.guesty\.test\/login/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: loginForm(`${MOCK_BASE}/dashboard`),
      });
    });

    await context.route(/mock\.guesty\.test\/dashboard/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: dashboardPage,
      });
    });

    const page = await loginToGuesty(context, {
      email: 'test@example.com',
      password: 'correct-password',
    });

    expect(page.url()).toContain('/dashboard');
    expect(page.url()).not.toContain('/login');

    await context.close();
  });

  test('throws LoginFailedError when form stays on /login (wrong credentials)', async ({ browser }) => {
    const context = await browser.newContext();

    // /login form action loops back to /login — simulates wrong password
    await context.route(/mock\.guesty\.test\/login/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: loginForm(`${MOCK_BASE}/login`),
      });
    });

    await expect(
      loginToGuesty(context, { email: 'test@example.com', password: 'wrong-password' })
    ).rejects.toThrow(LoginFailedError);

    await context.close();
  });

  test('throws LoginFailedError with 2FA message when 2FA prompt is detected', async ({ browser }) => {
    const context = await browser.newContext();

    // First request: serve the login form; subsequent requests: serve 2FA page
    let callCount = 0;
    await context.route(/mock\.guesty\.test\/login/, async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: callCount === 1 ? loginForm(`${MOCK_BASE}/login`) : twoFactorPage,
      });
    });

    let thrownError: Error | null = null;
    try {
      await loginToGuesty(context, { email: 'test@example.com', password: 'password' });
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError).toBeInstanceOf(LoginFailedError);
    expect(thrownError?.message).toMatch(/2FA|two-factor/i);

    await context.close();
  });
});
