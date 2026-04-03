import Bull from 'bull';
import { logger } from '../utils/logger';

// ── Job payload types ─────────────────────────────────────────────────────────

export interface MigrationJobPayload {
  jobId: string;
  sourceCredentials: {
    encryptedEmail: string;
    encryptedPassword: string;
    clientId: string;
    clientSecret: string;
  };
  destCredentials: {
    encryptedEmail: string;
    encryptedPassword: string;
  };
  requestedAt: string;
}

// ── Queue singleton ───────────────────────────────────────────────────────────

let _queue: Bull.Queue<MigrationJobPayload> | null = null;

/**
 * Returns the singleton Bull queue instance, creating it on first call.
 * Queue is backed by Redis at REDIS_URL.
 */
export function getMigrationQueue(): Bull.Queue<MigrationJobPayload> {
  if (_queue) return _queue;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  _queue = new Bull<MigrationJobPayload>('rate-strategy-migration', redisUrl, {
    defaultJobOptions: {
      attempts: 1,
      timeout: Number(process.env.JOB_TIMEOUT_MS ?? 600_000),
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  _queue.on('error', (err) => {
    logger.error({ error: err.message }, 'Bull queue error');
  });

  logger.info({ redisUrl: redisUrl.replace(/:[^:@]+@/, ':***@') }, 'Bull queue initialised');
  return _queue;
}
