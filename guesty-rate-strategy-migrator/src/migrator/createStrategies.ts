import { type Page } from '@playwright/test';
import pino from 'pino';
import type { RateStrategy, RateStrategyRule } from '../api-client/guestyOpenApi';
import { logger } from '../utils/logger';

// ── Error types ───────────────────────────────────────────────────────────────

export class UIChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UIChangedError';
  }
}

export class PartialMigrationError extends Error {
  public readonly successCount: number;
  public readonly failureCount: number;
  public readonly errors: MigrationError[];

  constructor(successCount: number, failureCount: number, errors: MigrationError[]) {
    super(`Partial migration: ${successCount} succeeded, ${failureCount} failed`);
    this.name = 'PartialMigrationError';
    this.successCount = successCount;
    this.failureCount = failureCount;
    this.errors = errors;
  }
}

export interface MigrationError {
  strategyName: string;
  ruleIndex?: number;
  error: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GUESTY_APP_URL = process.env.GUESTY_APP_URL ?? 'https://app.guesty.com';
const STRATEGY_URL   = `${GUESTY_APP_URL}/revenue-management/rate-strategy`;
const DEFAULT_TIMEOUT = Number(process.env.BROWSER_TIMEOUT_MS ?? 15_000);

// ── Rule fill helpers ─────────────────────────────────────────────────────────

async function fillSeasonRule(page: Page, rule: RateStrategyRule): Promise<void> {
  if (rule.name) {
    const nameInput = page.getByLabel(/rule name/i).first();
    await nameInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await nameInput.fill(rule.name);
  }
  if (rule.dateRanges && rule.dateRanges.length > 0) {
    const range = rule.dateRanges[0];
    const startInput = page.getByLabel(/start date/i).first();
    await startInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await startInput.fill(range.startDate);

    const endInput = page.getByLabel(/end date/i).first();
    await endInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await endInput.fill(range.endDate);
  }
  if (rule.adjustment) {
    const adjInput = page.getByLabel(/adjustment|price change/i).first();
    await adjInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await adjInput.fill(String(rule.adjustment.value));
  }
  if (rule.minNights != null) {
    const minNightsInput = page.getByLabel(/min.*nights/i).first();
    await minNightsInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await minNightsInput.fill(String(rule.minNights));
  }
}

async function fillOccupancyRule(page: Page, rule: RateStrategyRule): Promise<void> {
  const conditions = (rule.conditions ?? {}) as Record<string, unknown>;
  const threshold = (conditions.threshold as number | undefined) ?? 0;

  const thresholdInput = page.getByLabel(/threshold|occupancy.*%|percentage/i).first();
  await thresholdInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await thresholdInput.fill(String(threshold));

  if (rule.adjustment) {
    const adjInput = page.getByLabel(/adjustment|price/i).first();
    await adjInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await adjInput.fill(String(rule.adjustment.value));
  }
}

async function fillDayOfWeekRule(page: Page, rule: RateStrategyRule): Promise<void> {
  const conditions = (rule.conditions ?? {}) as Record<string, unknown>;
  const days = (conditions.days as string[] | undefined) ?? [];

  for (const day of days) {
    const dayToggle = page
      .getByLabel(new RegExp(day, 'i'))
      .or(page.getByRole('checkbox', { name: new RegExp(day, 'i') }))
      .first();
    const isVisible = await dayToggle.isVisible().catch(() => false);
    if (isVisible) await dayToggle.check();
  }

  if (rule.adjustment) {
    const adjInput = page.getByLabel(/adjustment|price/i).first();
    await adjInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await adjInput.fill(String(rule.adjustment.value));
  }
}

async function fillGapFillRule(page: Page, rule: RateStrategyRule): Promise<void> {
  const conditions = (rule.conditions ?? {}) as Record<string, unknown>;
  const gapLength = (conditions.gapLength as number | undefined) ?? 1;

  const gapInput = page.getByLabel(/gap.*length|gap.*nights/i).first();
  await gapInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await gapInput.fill(String(gapLength));

  if (rule.minNights != null) {
    const minNightsInput = page.getByLabel(/min.*nights/i).first();
    await minNightsInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    await minNightsInput.fill(String(rule.minNights));
  }
}

async function addRule(page: Page, rule: RateStrategyRule): Promise<void> {
  // Click "Add Rule" button
  const addRuleButton = page.getByRole('button', { name: /add rule/i });
  await addRuleButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await addRuleButton.click();

  // Select rule type if a type dropdown is present
  const ruleTypeSelector = page
    .getByRole('combobox', { name: /rule type/i })
    .or(page.locator('[data-testid="rule-type-select"]'))
    .first();
  const hasTypeSelector = await ruleTypeSelector.isVisible().catch(() => false);
  if (hasTypeSelector) {
    await ruleTypeSelector.selectOption(rule.type);
  }

  // Fill rule-type-specific fields
  switch (rule.type) {
    case 'season':
    case 'holiday':
      await fillSeasonRule(page, rule);
      break;
    case 'occupancy':
      await fillOccupancyRule(page, rule);
      break;
    case 'dayOfWeek':
      await fillDayOfWeekRule(page, rule);
      break;
    case 'gapFill':
      await fillGapFillRule(page, rule);
      break;
    default:
      // Unknown rule type — try to fill name only, do not abort
      logger.warn({ ruleType: rule.type }, 'Unknown rule type — filling name only');
      if (rule.name) {
        const nameInput = page.getByLabel(/rule name/i).first();
        const hasName = await nameInput.isVisible().catch(() => false);
        if (hasName) await nameInput.fill(rule.name);
      }
  }

  // Save the individual rule (reduces blast radius vs batching all rules)
  const saveRuleButton = page.getByRole('button', { name: /save rule|apply|confirm/i });
  await saveRuleButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await saveRuleButton.click();
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface CreateStrategiesResult {
  successCount: number;
  failureCount: number;
  errors: MigrationError[];
}

/**
 * Recreates a list of Rate Strategies in the destination Guesty account via
 * Playwright browser automation. For each strategy:
 *   1. Navigates to the Rate Strategy section.
 *   2. Clicks "New Rate Strategy", fills name/description, saves the skeleton.
 *   3. Iterates rules and adds them one by one, saving after each.
 *
 * Individual rule failures are logged and recorded but do NOT abort the strategy.
 * Individual strategy failures are logged and recorded but do NOT abort the job.
 * This ensures partial migration is better than full failure.
 *
 * Uses resilience-first selectors: getByRole, getByLabel, getByText, getByTestId.
 * Avoids nth() positional selectors.
 */
export async function createStrategies(
  page: Page,
  strategies: RateStrategy[],
  jobLog: pino.Logger
): Promise<CreateStrategiesResult> {
  let successCount = 0;
  let failureCount = 0;
  const errors: MigrationError[] = [];

  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  for (const strategy of strategies) {
    jobLog.info({ strategyName: strategy.name }, 'Creating rate strategy');

    try {
      await page.goto(STRATEGY_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

      // Click "New Rate Strategy"
      const newButton = page.getByRole('button', { name: /new rate strategy/i });
      await newButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      await newButton.click();

      // Fill strategy name
      const nameInput = page.getByLabel(/strategy name|name/i).first();
      await nameInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      await nameInput.fill(strategy.name);

      // Fill description if present
      if (strategy.description) {
        const descInput = page.getByLabel(/description/i).first();
        const hasDesc = await descInput.isVisible().catch(() => false);
        if (hasDesc) await descInput.fill(strategy.description);
      }

      // Save the strategy skeleton before adding rules
      const saveButton = page.getByRole('button', { name: /save|create/i }).first();
      await saveButton.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      await saveButton.click();
      await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT }).catch(() => {});

      // Add rules one by one
      for (let i = 0; i < strategy.rules.length; i++) {
        const rule = strategy.rules[i];
        jobLog.info(
          { strategyName: strategy.name, ruleType: rule.type, ruleIndex: i },
          'Adding rule'
        );
        try {
          await addRule(page, rule);
        } catch (ruleErr) {
          const errMsg = (ruleErr as Error).message;
          jobLog.error(
            { strategyName: strategy.name, ruleIndex: i, error: errMsg },
            'Rule addition failed — continuing to next rule'
          );
          errors.push({ strategyName: strategy.name, ruleIndex: i, error: errMsg });
        }
      }

      jobLog.info({ strategyName: strategy.name }, 'Strategy created successfully');
      successCount++;
    } catch (strategyErr) {
      const errMsg = (strategyErr as Error).message;

      // If a critical element was not found, classify as UIChangedError
      if (errMsg.includes('Timeout') || errMsg.includes('not found')) {
        jobLog.error(
          { strategyName: strategy.name, error: errMsg },
          'UI selector not found — Guesty UI may have changed (UIChangedError)'
        );
        errors.push({
          strategyName: strategy.name,
          error: `UIChangedError: ${errMsg}`,
        });
      } else {
        jobLog.error(
          { strategyName: strategy.name, error: errMsg },
          'Strategy creation failed — continuing to next strategy'
        );
        errors.push({ strategyName: strategy.name, error: errMsg });
      }
      failureCount++;
    }
  }

  return { successCount, failureCount, errors };
}
