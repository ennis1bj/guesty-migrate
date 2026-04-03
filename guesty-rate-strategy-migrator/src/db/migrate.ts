import 'dotenv/config';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Idempotent schema migration. Creates the rate_strategy_migrator schema and
 * job_history table if they do not already exist. Safe to run on every startup.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS rate_strategy_migrator;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_strategy_migrator.job_history (
        job_id           TEXT PRIMARY KEY,
        triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at     TIMESTAMPTZ,
        source_client_id TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'queued',
        strategy_count   INT,
        migrated_count   INT,
        failed_count     INT,
        errors           JSONB,
        duration_ms      INT
      );
    `);

    logger.info('rate_strategy_migrator DB migrations completed');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err: Error) => {
      logger.error({ error: err.message }, 'DB migration failed');
      process.exit(1);
    });
}
