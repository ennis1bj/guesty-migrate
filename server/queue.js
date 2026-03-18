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
        console.log(`Processing migration job ${job.data.migrationId}`);
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

async function enqueueMigration(migrationId) {
  if (useRedis && migrationQueue) {
    await migrationQueue.add('run-migration', { migrationId });
    console.log(`Enqueued migration ${migrationId} to BullMQ`);
  } else {
    // In-process fallback — run async, don't block
    console.log(`Running migration ${migrationId} in-process`);
    setImmediate(() => {
      runMigration(migrationId).catch((err) => {
        console.error(`In-process migration ${migrationId} failed:`, err);
      });
    });
  }
}

module.exports = { initQueue, enqueueMigration };
