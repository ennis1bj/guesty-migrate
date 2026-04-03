import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { migrationRequestSchema } from '../schemas/migrationSchema';
import { encrypt } from '../utils/crypto';
import { getMigrationQueue, type MigrationJobPayload } from '../jobs/migrationQueue';
import { createJobRecord, getJobRecord, listJobRecords } from '../db/jobRepository';
import { logger } from '../utils/logger';

export const router = Router();

// ── Rate limiting ─────────────────────────────────────────────────────────────

const postLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many migration requests — maximum 5 per minute per IP' },
});

// ── POST /api/v1/migrations ───────────────────────────────────────────────────

/**
 * Triggers a new rate strategy migration job.
 *
 * Validates the request with Zod, encrypts credentials with AES-256-GCM,
 * writes an initial 'queued' record to PostgreSQL, then enqueues the job.
 *
 * Returns: { jobId, status: 'queued' }
 */
router.post('/', postLimiter, async (req: Request, res: Response): Promise<void> => {
  const parseResult = migrationRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.flatten(),
    });
    return;
  }

  const {
    sourceClientId,
    sourceClientSecret,
    sourceEmail,
    sourcePassword,
    destEmail,
    destPassword,
  } = parseResult.data;

  const jobId       = uuidv4();
  const requestedAt = new Date().toISOString();

  const payload: MigrationJobPayload = {
    jobId,
    sourceCredentials: {
      encryptedEmail:    encrypt(sourceEmail),
      encryptedPassword: encrypt(sourcePassword),
      clientId:          sourceClientId,
      clientSecret:      sourceClientSecret,
    },
    destCredentials: {
      encryptedEmail:    encrypt(destEmail),
      encryptedPassword: encrypt(destPassword),
    },
    requestedAt,
  };

  try {
    // Write initial record to DB before enqueuing (so status is visible immediately)
    await createJobRecord({ jobId, sourceClientId });
    await getMigrationQueue().add(payload, { jobId });
    logger.info({ jobId }, 'Migration job enqueued');
    res.status(202).json({ jobId, status: 'queued' });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to create migration job');
    res.status(500).json({ error: 'Failed to create migration job' });
  }
});

// ── GET /api/v1/migrations ────────────────────────────────────────────────────

/**
 * Lists job history from PostgreSQL, ordered by most recent first.
 * Supports pagination via ?limit=N&offset=N query params.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const limit  = Math.min(parseInt(String(req.query.limit  ?? '20'), 10), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'),  10), 0);

  try {
    const jobs = await listJobRecords(limit, offset);
    res.json({ jobs, limit, offset });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to list migration jobs');
    res.status(500).json({ error: 'Failed to retrieve job history' });
  }
});

// ── GET /api/v1/migrations/:jobId ─────────────────────────────────────────────

/**
 * Returns the current status of a specific job.
 * Reads from PostgreSQL so history persists beyond Redis eviction.
 *
 * Returns: { jobId, status, triggeredAt, completedAt, durationMs,
 *            strategyCount, migratedCount, failedCount, errors[] }
 */
router.get('/:jobId', async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;

  try {
    const record = await getJobRecord(jobId);
    if (!record) {
      res.status(404).json({ error: `Job not found: ${jobId}` });
      return;
    }
    res.json(record);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to retrieve job status');
    res.status(500).json({ error: 'Failed to retrieve job status' });
  }
});
