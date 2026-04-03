import { type Page } from '@playwright/test';
import pino from 'pino';
import type { RateStrategy } from '../api-client/guestyOpenApi';
import { logger } from '../utils/logger';

const GUESTY_APP_URL = process.env.GUESTY_APP_URL ?? 'https://app.guesty.com';
const STRATEGY_LIST_URL = `${GUESTY_APP_URL}/revenue-management/rate-strategy`;
const DEFAULT_TIMEOUT = Number(process.env.BROWSER_TIMEOUT_MS ?? 15_000);

export interface UIStrategySummary {
  name: string;
  ruleCount: number;
}

/**
 * Reads the Rate Strategy list from the Guesty UI and returns a lightweight
 * summary (name + rule count) for each strategy.
 *
 * This is a best-effort extraction — Guesty UI changes may alter the selectors.
 * The result is used only for count validation against the Open API response,
 * not as the source of truth for migration.
 */
export async function extractStrategiesFromUI(page: Page): Promise<UIStrategySummary[]> {
  await page.goto(STRATEGY_LIST_URL, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT });

  // Wait for the strategy list container
  const listContainer = page
    .getByRole('list')
    .or(page.locator('[data-testid="rate-strategies-list"]'))
    .first();

  await listContainer.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT }).catch(() => {
    logger.warn('extractStrategiesFromUI: strategy list container not found — UI may have changed');
  });

  const rows = await page
    .locator('[data-testid="rate-strategy-row"]')
    .or(page.getByRole('listitem'))
    .all();

  const summaries: UIStrategySummary[] = [];

  for (const row of rows) {
    const name =
      (await row.getByRole('heading').textContent().catch(() => null)) ??
      (await row.textContent().catch(() => null)) ??
      '';

    const ruleCountText = await row
      .locator('[data-testid="rule-count"]')
      .textContent()
      .catch(() => '');

    const ruleCount = parseInt(ruleCountText?.match(/\d+/)?.[0] ?? '0', 10);
    summaries.push({ name: name.trim(), ruleCount });
  }

  return summaries;
}

/**
 * Optional UI validation cross-check. Compares the Open API strategy count
 * against what is visible in the Guesty dashboard. If counts differ, logs a
 * warning and proceeds with the Open API data as the source of truth.
 *
 * Controlled by the ENABLE_UI_VALIDATION environment variable.
 * Set ENABLE_UI_VALIDATION=true to activate; disabled by default.
 */
export async function validateWithUI(
  page: Page,
  apiStrategies: RateStrategy[],
  jobLog: pino.Logger
): Promise<void> {
  if (process.env.ENABLE_UI_VALIDATION !== 'true') {
    jobLog.info('UI validation disabled (ENABLE_UI_VALIDATION != true) — skipping');
    return;
  }

  jobLog.info('Running UI strategy count validation cross-check');

  const uiSummaries = await extractStrategiesFromUI(page);

  if (uiSummaries.length !== apiStrategies.length) {
    jobLog.warn(
      { apiCount: apiStrategies.length, uiCount: uiSummaries.length },
      'UI strategy count does not match Open API count — proceeding with Open API data as source of truth'
    );
  } else {
    jobLog.info({ count: apiStrategies.length }, 'UI validation passed — strategy counts match');
  }
}
