import 'dotenv/config';
import express from 'express';
import { router as migrationsRouter } from './api/routes';
import { initPool } from './db/jobRepository';
import { runMigrations } from './db/migrate';
import { startWorker } from './jobs/migrationWorker';
import { logger } from './utils/logger';

const PORT = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  // ── Database ──────────────────────────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.error('DATABASE_URL is required — set it in your environment');
    process.exit(1);
  }

  initPool(dbUrl);

  // Run idempotent schema migration on every startup
  await runMigrations();

  // ── Background worker ─────────────────────────────────────────────────────
  startWorker();

  // ── Express app ───────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1/migrations', migrationsRouter);

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'guesty-rate-strategy-migrator listening');
  });
}

main().catch((err: Error) => {
  logger.error({ error: err.message }, 'Fatal startup error');
  process.exit(1);
});
