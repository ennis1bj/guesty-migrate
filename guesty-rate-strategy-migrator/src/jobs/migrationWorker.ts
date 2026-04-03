import type Bull from 'bull';
import { getMigrationQueue, type MigrationJobPayload } from './migrationQueue';
import { decrypt } from '../utils/crypto';
import {
  createIsolatedContext,
  captureFailureScreenshot,
  startScreenshotCleanup,
  closeBrowser,
} from '../utils/browser';
import { fetchRateStrategies } from '../api-client/guestyOpenApi';
import { loginToGuesty, LoginFailedError } from '../migrator/guestyAuth';
import { validateWithUI } from '../migrator/extractStrategies';
import { createStrategies, PartialMigrationError } from '../migrator/createStrategies';
import { updateJobRecord } from '../db/jobRepository';
import { logger } from '../utils/logger';

// ── Error types ───────────────────────────────────────────────────────────────

export class StrategyNotFoundError extends Error {
  constructor() {
    super('No rate strategies found in the source account');
    this.name = 'StrategyNotFoundError';
  }
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processJob(job: Bull.Job<MigrationJobPayload>): Promise<void> {
  const { jobId, sourceCredentials, destCredentials } = job.data;
  const jobLog = logger.child({ jobId });

  const startedAt = Date.now();
  jobLog.info('Migration job started');

  await updateJobRecord(jobId, { status: 'running' });

  // Decrypt credentials in-memory — never stored to disk or DB
  const sourceEmail    = decrypt(sourceCredentials.encryptedEmail);
  const sourcePassword = decrypt(sourceCredentials.encryptedPassword);
  const destEmail      = decrypt(destCredentials.encryptedEmail);
  const destPassword   = decrypt(destCredentials.encryptedPassword);

  // Fetch source strategies via Guesty Open API
  jobLog.info('Fetching rate strategies from source account via Open API');
  const strategies = await fetchRateStrategies(
    sourceCredentials.clientId,
    sourceCredentials.clientSecret
  );

  if (strategies.length === 0) {
    const err = new StrategyNotFoundError();
    await updateJobRecord(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      strategyCount: 0,
      errors: [{ strategyName: '__job__', error: err.message }],
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }

  jobLog.info({ count: strategies.length }, 'Rate strategies fetched');
  await updateJobRecord(jobId, { strategyCount: strategies.length });

  const sourceContext = await createIsolatedContext();
  const destContext   = await createIsolatedContext();

  try {
    // Optional: UI validation cross-check on source account
    if (process.env.ENABLE_UI_VALIDATION === 'true') {
      jobLog.info('Authenticating to source account for UI validation');
      const sourcePage = await loginToGuesty(sourceContext, {
        email: sourceEmail,
        password: sourcePassword,
      });
      await validateWithUI(sourcePage, strategies, jobLog);
    }

    // Authenticate to destination account
    jobLog.info('Authenticating to destination account');
    const destPage = await loginToGuesty(destContext, {
      email: destEmail,
      password: destPassword,
    });

    // Recreate strategies in destination account via UI automation
    jobLog.info({ count: strategies.length }, 'Creating strategies in destination account');
    const { successCount, failureCount, errors } = await createStrategies(
      destPage,
      strategies,
      jobLog
    );

    const durationMs   = Date.now() - startedAt;
    const finalStatus  =
      failureCount === 0              ? 'completed' :
      successCount === 0              ? 'failed'    :
      /* some passed, some failed */    'partial';

    await updateJobRecord(jobId, {
      status: finalStatus,
      completedAt: new Date().toISOString(),
      migratedCount: successCount,
      failedCount: failureCount,
      errors: errors.length > 0 ? errors : null,
      durationMs,
    });

    jobLog.info({ successCount, failureCount, durationMs }, 'Migration job complete');

    if (failureCount > 0) {
      throw new PartialMigrationError(successCount, failureCount, errors);
    }
  } catch (err) {
    // PartialMigrationError is already recorded above — just rethrow
    if (err instanceof PartialMigrationError) throw err;

    // All other errors: capture screenshot + record failure
    await captureFailureScreenshot(destContext, jobId);

    const durationMs = Date.now() - startedAt;
    await updateJobRecord(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      errors: [{ strategyName: '__job__', error: (err as Error).message }],
      durationMs,
    }).catch(() => {});

    throw err;
  } finally {
    // Always close contexts regardless of outcome
    await sourceContext.close().catch(() => {});
    await destContext.close().catch(() => {});
  }
}

// ── Worker startup ────────────────────────────────────────────────────────────

/**
 * Starts the Bull queue worker. Processes one job at a time (concurrency = 1)
 * to ensure the singleton Chromium browser is not overloaded.
 *
 * Also starts the screenshot cleanup cron.
 */
export function startWorker(): void {
  startScreenshotCleanup();

  const queue = getMigrationQueue();

  // Process 1 job at a time — Playwright browser is a singleton
  queue.process(1, processJob);

  queue.on('completed', (job) => {
    logger.info({ jobId: job.data.jobId }, 'Bull job completed');
  });

  queue.on('failed', (job, err) => {
    logger.error({ jobId: job?.data?.jobId, error: err.message }, 'Bull job failed');
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — closing queue and browser');
    await queue.close();
    await closeBrowser();
    process.exit(0);
  });

  logger.info('Migration worker started (concurrency=1)');
}
