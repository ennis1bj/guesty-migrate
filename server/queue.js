let Queue, Worker;

try {
  const bullmq = require('bullmq');
  Queue = bullmq.Queue;
  Worker = bullmq.Worker;
} catch {
  // BullMQ not available
}

const { runMigration } = require('./migrationEngine');

let migrationQueue = null;
let migrationWorker = null;
let useRedis = false;

function initQueue() {
  if (!process.env.REDIS_URL) {
    console.log('REDIS_URL not set — using in-process job execution');
    return;
  }

  if (!Queue || !Worker) {
    console.log('BullMQ not available — using in-process job execution');
    return;
  }

  try {
    const connection = { url: process.env.REDIS_URL };

    migrationQueue = new Queue('migrations', { connection });

    migrationWorker = new Worker(
      'migrations',
      async (job) => {
        console.log(`Processing migration job ${job.data.migrationId} (priority=${job.opts?.priority || 'default'})`);
        await runMigration(job.data.migrationId);
      },
      { connection, concurrency: 2 }
    );

    migrationWorker.on('completed', (job) => {
      console.log(`Migration job ${job.id} completed`);
    });

    migrationWorker.on('failed', (job, err) => {
      console.error(`Migration job ${job.id} failed:`, err.message);
    });

    useRedis = true;
    console.log('BullMQ queue initialized with Redis');
  } catch (err) {
    console.log('Redis connection failed — falling back to in-process execution:', err.message);
    migrationQueue = null;
    migrationWorker = null;
  }
}

async function enqueueMigration(migrationId, options = {}) {
  const priority = options.priority || 10;

  if (useRedis && migrationQueue) {
    await migrationQueue.add(
      'run-migration',
      { migrationId },
      { priority }
    );
    console.log(`Enqueued migration ${migrationId} to BullMQ (priority=${priority})`);
  } else {
    // In-process fallback — run async, don't block
    console.log(`Running migration ${migrationId} in-process (priority=${priority})`);
    setImmediate(() => {
      runMigration(migrationId).catch((err) => {
        console.error(`In-process migration ${migrationId} failed:`, err);
      });
    });
  }
}

async function recoverStuckMigrations() {
  try {
    const { pool } = require('./db');
    const result = await pool.query(
      "SELECT id FROM migrations WHERE status = 'running' AND created_at < NOW() - INTERVAL '1 hour'"
    );
    for (const row of result.rows) {
      console.log(`Recovering stuck migration ${row.id}`);
      await pool.query(
        "UPDATE migrations SET status = 'failed', error_message = 'Server restarted during migration' WHERE id = $1",
        [row.id]
      );
    }
    console.log(`Recovered ${result.rows.length} stuck migrations`);
  } catch (err) {
    console.error('Failed to recover stuck migrations:', err.message);
  }
}

module.exports = { initQueue, enqueueMigration, recoverStuckMigrations };
