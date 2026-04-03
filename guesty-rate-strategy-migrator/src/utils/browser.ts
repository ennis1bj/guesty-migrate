import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

const SCREENSHOT_DIR = '/tmp';
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let browserInstance: Browser | null = null;

/**
 * Returns a singleton Chromium browser instance. If the browser has crashed or
 * disconnected, a fresh instance is launched automatically.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  logger.info('Launching Chromium browser instance');
  browserInstance = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
  });
  browserInstance.on('disconnected', () => {
    logger.warn('Browser disconnected — will relaunch on next job');
    browserInstance = null;
  });
  return browserInstance;
}

/**
 * Creates a new isolated BrowserContext for a single migration job.
 * No cookies, storage, or session state is shared between contexts.
 */
export async function createIsolatedContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (compatible; GuestyMigrate/1.0)',
  });
}

/**
 * Captures a screenshot of the last open page in the context to /tmp for debugging.
 * Silently skips if no pages are open or screenshot fails.
 */
export async function captureFailureScreenshot(
  context: BrowserContext,
  jobId: string
): Promise<void> {
  try {
    const pages = context.pages();
    if (pages.length === 0) return;
    const page = pages[pages.length - 1];
    const screenshotPath = path.join(SCREENSHOT_DIR, `migration-failure-${jobId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info({ jobId, screenshotPath }, 'Failure screenshot saved');
  } catch (err) {
    logger.warn({ jobId, error: (err as Error).message }, 'Could not capture failure screenshot');
  }
}

/**
 * Starts a background interval that deletes failure screenshots older than 24 hours.
 * Call once at worker startup.
 */
export function startScreenshotCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    try {
      const files = fs
        .readdirSync(SCREENSHOT_DIR)
        .filter((f) => f.startsWith('migration-failure-') && f.endsWith('.png'));
      const now = Date.now();
      for (const file of files) {
        const filePath = path.join(SCREENSHOT_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > MAX_AGE_MS) {
            fs.unlinkSync(filePath);
            logger.info({ file }, 'Deleted stale failure screenshot');
          }
        } catch {
          /* file may have been deleted between readdir and statSync — ignore */
        }
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Screenshot cleanup error');
    }
  }, CLEANUP_INTERVAL_MS);
}

/** Gracefully closes the singleton browser. Call on process shutdown. */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
