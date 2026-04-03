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
import { loginToGuesty } from '../migrator/guestyAuth';
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

  // Mark running immediately so status is visible even if subsequent steps throw
  await updateJobRecord(jobId, { status: 'running' }).catch((dbErr: Error) => {
    jobLog.warn({ error: dbErr.message }, 'Could not mark job as running in DB — proceeding');
  });

  // Browser contexts declared outside try so finally can close them
  let sourceContext: Awaited<ReturnType<typeof createIsolatedContext>> | null = null;
  let destContext:   Awaited<ReturnType<typeof createIsolatedContext>> | null = null;

  try {
    // ── Decrypt all credentials in-memory — never written to disk or DB ─────
    const sourceEmail         = decrypt(sourceCredentials.encryptedEmail);
    const sourcePassword      = decrypt(sourceCredentials.encryptedPassword);
    const sourceClientId      = decrypt(sourceCredentials.encryptedClientId);
    const sourceClientSecret  = decrypt(sourceCredentials.encryptedClientSecret);
    const destEmail           = decrypt(destCredentials.encryptedEmail);
    const destPassword        = decrypt(destCredentials.encryptedPassword);

    // ── Fetch source strategies via Guesty Open API ──────────────────────────
    jobLog.info('Fetching rate strategies from source account via Open API');
    const strategies = await fetchRateStrategies(sourceClientId, sourceClientSecret);

    if (strategies.length === 0) {
      throw new StrategyNotFoundError();
    }

    jobLog.info({ count: strategies.length }, 'Rate strategies fetched');
    await updateJobRecord(jobId, { strategyCount: strategies.length }).catch(() => {});

    // ── Create browser contexts ──────────────────────────────────────────────
    sourceContext = await createIsolatedContext();
    destContext   = await createIsolatedContext();

    // ── Optional: UI validation cross-check on source account ───────────────
    if (process.env.ENABLE_UI_VALIDATION === 'true') {
      jobLog.info('Authenticating to source account for UI validation');
      const sourcePage = await loginToGuesty(sourceContext, {
        email: sourceEmail,
        password: sourcePassword,
      });
      await validateWithUI(sourcePage, strategies, jobLog);
    }

    // ── Authenticate to destination account ──────────────────────────────────
    jobLog.info('Authenticating to destination account');
    const destPage = await loginToGuesty(destContext, {
      email: destEmail,
      password: destPassword,
    });

    // ── Recreate strategies in destination account via UI automation ─────────
    jobLog.info({ count: strategies.length }, 'Creating strategies in destination account');
    const { successCount, failureCount, errors } = await createStrategies(
      destPage,
      strategies,
      jobLog
    );

    const durationMs  = Date.now() - startedAt;
    const finalStatus =
      failureCount === 0  ? 'completed'
      : successCount === 0 ? 'failed'
      :                      'partial';

    await updateJobRecord(jobId, {
      status: finalStatus,
      completedAt: new Date().toISOString(),
      migratedCount: successCount,
      failedCount: failureCount,
      errors: errors.length > 0 ? errors : null,
      durationMs,
    });

    jobLog.info({ successCount, failureCount, durationMs }, 'Migration job complete');

    // Throw so Bull records the job as failed — DB already has the partial record
    if (failureCount > 0) {
      throw new PartialMigrationError(successCount, failureCount, errors);
    }
  } catch (err) {
    // PartialMigrationError: DB is already up to date — just rethrow for Bull
    if (err instanceof PartialMigrationError) throw err;

    // Capture failure screenshot before closing the dest context
    if (destContext) {
      await captureFailureScreenshot(destContext, jobId).catch(() => {});
    }

    // Always write a terminal status so the row never stays 'running'
    await updateJobRecord(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      errors: [{ strategyName: '__job__', error: (err as Error).message }],
      durationMs: Date.now() - startedAt,
    }).catch((dbErr: Error) => {
      jobLog.error({ error: dbErr.message }, 'Could not write failed status to DB');
    });

    throw err;
  } finally {
    // Always close browser contexts regardless of outcome
    if (sourceContext) await sourceContext.close().catch(() => {});
    if (destContext)   await destContext.close().catch(() => {});
  }
}

// ── Worker startup ────────────────────────────────────────────────────────────

/**
 * Starts the Bull queue worker. Processes one job at a time (concurrency = 1)
 * to ensure the singleton Chromium browser is not overloaded.
 *
 * Also starts the 24-hour failure screenshot cleanup cron.
 */
export function startWorker(): void {
  startScreenshotCleanup();

  const queue = getMigrationQueue();

  // Process 1 job at a time — Playwright browser is a singleton resource
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
