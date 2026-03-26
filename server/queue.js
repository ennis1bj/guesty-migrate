/**
 * Job queue module with BullMQ + Redis, including graceful in-process fallback.
 *
 * Fixes:
 *  #75 — TLS support via centralized redisConfig
 *  #76 — Error/close/reconnecting event handlers on Redis clients
 *  #77 — Redis validated at startup before queue init
 *  #78 — redisAvailable state tracking, periodic reconnection, health info
 *  #80 — Error handlers on both Redis client AND BullMQ queue/worker objects
 *  #81 — REDIS_URL parsing with proper auth handling
 */

let Queue, Worker;

try {
  const bullmq = require('bullmq');
  Queue = bullmq.Queue;
  Worker = bullmq.Worker;
} catch {
  // BullMQ not available
}

const { runMigration } = require('./migrationEngine');
const { logger } = require('./logger');
const {
  buildConnectionOptions,
  validateRedisConnection,
  isRedisAvailable,
  setRedisAvailable,
  startReconnectLoop,
  stopReconnectLoop,
} = require('./redisConfig');

let migrationQueue = null;
let migrationWorker = null;

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Attach error handlers to a BullMQ queue or worker's underlying Redis client
 * so ioredis never emits an unhandled 'error' event. (#80)
 */
function attachClientErrorHandler(bullmqObj, label) {
  if (!bullmqObj) return;

  // BullMQ exposes the underlying ioredis client via a `.client` promise
  // (Queue) or the `.client` getter (Worker). Handle both patterns.
  try {
    const clientProp = bullmqObj.client;
    if (clientProp && typeof clientProp.then === 'function') {
      // It's a promise (Queue)
      clientProp
        .then((c) => {
          if (c && typeof c.on === 'function') {
            c.on('error', (err) => {
              logger.error(`BullMQ internal Redis error [${label}]`, {
                error: err.message,
                code: err.code,
              });
            });
          }
        })
        .catch((err) => {
          logger.warn(`Could not attach Redis error handler [${label}]`, {
            error: err.message,
          });
        });
    }
  } catch {
    // client property not available yet — that's fine
  }
}

// ── Queue teardown ─────────────────────────────────────────────────────────────

async function closeQueue(reason) {
  if (!isRedisAvailable()) return;

  logger.warn(`BullMQ shutting down: ${reason} — falling back to in-process execution`);
  setRedisAvailable(false);

  const q = migrationQueue;
  const w = migrationWorker;
  migrationQueue = null;
  migrationWorker = null;

  try { await w?.close(); } catch {}
  try { await q?.close(); } catch {}

  // Start periodic reconnection attempts (#78)
  startReconnectLoop(initQueue);
}

// ── Queue initialization ───────────────────────────────────────────────────────

async function initQueue() {
  if (!process.env.REDIS_URL) {
    logger.info('REDIS_URL not set — using in-process job execution');
    return;
  }

  if (!Queue || !Worker) {
    logger.info('BullMQ not available — using in-process job execution');
    return;
  }

  // Validate Redis connectivity before handing to BullMQ (#77)
  const reachable = await validateRedisConnection();
  if (!reachable) {
    logger.warn('Redis unavailable at startup — using in-process job execution');
    setRedisAvailable(false);
    // Start reconnect loop so we can recover later (#78)
    startReconnectLoop(initQueue);
    return;
  }

  try {
    // Build ioredis-compatible connection options (handles TLS, auth, etc.)
    const connection = buildConnectionOptions();

    // ── Queue ────────────────────────────────────────────────────────────
    migrationQueue = new Queue('migrations', { connection });

    // Error handler on the Queue itself (#80)
    migrationQueue.on('error', (err) => {
      logger.error('BullMQ Queue error', { error: err.message });
      closeQueue(`Queue error: ${err.message}`);
    });

    // Error handler on the Queue's internal Redis client (#80)
    attachClientErrorHandler(migrationQueue, 'queue-client');

    // ── Worker ───────────────────────────────────────────────────────────
    migrationWorker = new Worker(
      'migrations',
      async (job) => {
        logger.info(`Processing migration job ${job.data.migrationId}`, {
          priority: job.opts?.priority || 'default',
        });
        await runMigration(job.data.migrationId);
      },
      { connection, concurrency: 2 }
    );

    migrationWorker.on('completed', (job) => {
      logger.info(`Migration job ${job.id} completed`);
    });

    migrationWorker.on('failed', (job, err) => {
      logger.error(`Migration job ${job?.id} failed`, { error: err.message });
    });

    // Error handler on the Worker itself (#80)
    migrationWorker.on('error', (err) => {
      logger.error('BullMQ Worker error', { error: err.message });
      closeQueue(`Worker error: ${err.message}`);
    });

    // Error handler on the Worker's internal Redis client (#80)
    attachClientErrorHandler(migrationWorker, 'worker-client');

    setRedisAvailable(true);
    stopReconnectLoop(); // clear any pending reconnect loop
    logger.info('BullMQ queue initialized with Redis');
  } catch (err) {
    logger.error('Redis queue initialization failed — falling back to in-process execution', {
      error: err.message,
    });
    migrationQueue = null;
    migrationWorker = null;
    setRedisAvailable(false);
    startReconnectLoop(initQueue);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function enqueueMigration(migrationId, options = {}) {
  const priority = options.priority || 10;

  if (isRedisAvailable() && migrationQueue) {
    try {
      await migrationQueue.add('run-migration', { migrationId }, { priority });
      logger.info(`Enqueued migration ${migrationId} to BullMQ`, { priority });
    } catch (err) {
      logger.error(`Failed to enqueue migration ${migrationId} to BullMQ — running in-process`, {
        error: err.message,
      });
      runMigrationInProcess(migrationId, priority);
    }
  } else {
    runMigrationInProcess(migrationId, priority);
  }
}

function runMigrationInProcess(migrationId, priority) {
  logger.info(`Running migration ${migrationId} in-process (degraded mode)`, { priority });
  setImmediate(() => {
    runMigration(migrationId).catch((err) => {
      logger.error(`In-process migration ${migrationId} failed`, { error: err.message });
    });
  });
}

async function recoverStuckMigrations() {
  try {
    const { pool } = require('./db');
    const result = await pool.query(
      "SELECT id FROM migrations WHERE status = 'running' AND created_at < NOW() - INTERVAL '1 hour'"
    );
    for (const row of result.rows) {
      logger.info(`Recovering stuck migration ${row.id}`);
      await pool.query(
        "UPDATE migrations SET status = 'failed', error_message = 'Server restarted during migration' WHERE id = $1",
        [row.id]
      );
    }
    logger.info(`Recovered ${result.rows.length} stuck migrations`);
  } catch (err) {
    logger.error('Failed to recover stuck migrations', { error: err.message });
  }
}

/**
 * Return current job execution mode info for health checks (#78).
 */
function getQueueHealth() {
  return {
    jobMode: isRedisAvailable() ? 'redis' : 'in-process',
    redisAvailable: isRedisAvailable(),
    redisConfigured: !!process.env.REDIS_URL,
    degraded: !!process.env.REDIS_URL && !isRedisAvailable(),
  };
}

module.exports = {
  initQueue,
  enqueueMigration,
  recoverStuckMigrations,
  getQueueHealth,
};
