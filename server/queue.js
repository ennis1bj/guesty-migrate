let Queue, Worker, Redis;

try {
  const bullmq = require('bullmq');
  Queue = bullmq.Queue;
  Worker = bullmq.Worker;
} catch {
  // BullMQ not available
}

try {
  Redis = require('ioredis');
} catch {
  // ioredis not available
}

const { runMigration } = require('./migrationEngine');

let migrationQueue = null;
let migrationWorker = null;
let useRedis = false;

async function initQueue() {
  if (!process.env.REDIS_URL) {
    console.log('REDIS_URL not set — using in-process job execution');
    return;
  }

  if (!Queue || !Worker || !Redis) {
    console.log('BullMQ/ioredis not available — using in-process job execution');
    return;
  }

  // Pre-test the connection before handing credentials to BullMQ.
  // This prevents BullMQ's internal RedisConnection from emitting an
  // unhandled 'error' event that would crash the process.
  const testClient = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    enableReadyCheck: false,
  });

  try {
    await testClient.connect();
    await testClient.ping();
  } catch (err) {
    console.warn(`Redis connection test failed (${err.message}) — using in-process job execution`);
    try { testClient.disconnect(); } catch {}
    return;
  } finally {
    try { testClient.disconnect(); } catch {}
  }

  try {
    const connection = { url: process.env.REDIS_URL };

    async function closeRedis(reason) {
      if (!useRedis) return;
      console.warn(`BullMQ ${reason} — falling back to in-process`);
      useRedis = false;
      const q = migrationQueue;
      const w = migrationWorker;
      migrationQueue = null;
      migrationWorker = null;
      try { await w?.close(); } catch {}
      try { await q?.close(); } catch {}
    }

    migrationQueue = new Queue('migrations', { connection });
    migrationQueue.on('error', (err) => closeRedis(`Queue error: ${err.message}`));

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
      console.error(`Migration job ${job?.id} failed:`, err.message);
    });

    migrationWorker.on('error', (err) => closeRedis(`Worker error: ${err.message}`));

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
