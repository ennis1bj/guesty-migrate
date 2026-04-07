const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { logger } = require('./logger');

if (!process.env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL environment variable is required but not set.\n');
  process.exit(1);
}

// ── SSL configuration (#79) ────────────────────────────────────────────────────
// Use explicit `ssl` object instead of deprecated sslmode query parameter.
// This avoids the pg v8.11+ deprecation warning and prepares for pg v9 changes.
//
// DB_SSL options:
//   'true' / '1'  — verify server certificate (rejectUnauthorized: true)
//   'no-verify'   — connect with TLS but accept self-signed certs
//   'false' / '0' — no SSL
//   unset         — auto-detect from DATABASE_URL (ssl if sslmode present)
function buildSslConfig() {
  const dbSsl = process.env.DB_SSL;

  if (dbSsl === 'false' || dbSsl === '0') {
    return false;
  }
  if (dbSsl === 'no-verify') {
    return { rejectUnauthorized: false };
  }
  if (dbSsl === 'true' || dbSsl === '1') {
    return { rejectUnauthorized: true };
  }

  // Auto-detect: if DATABASE_URL contains sslmode, enable SSL explicitly
  const url = process.env.DATABASE_URL || '';
  if (url.includes('sslmode=')) {
    return { rejectUnauthorized: true };
  }

  // No SSL indicator — let pg use its default behavior
  return undefined;
}

const sslConfig = buildSslConfig();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ...(sslConfig !== undefined ? { ssl: sslConfig } : {}),
});

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        source_client_id TEXT NOT NULL,
        source_client_secret TEXT NOT NULL,
        dest_client_id TEXT NOT NULL,
        dest_client_secret TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        manifest JSONB,
        selected_categories TEXT[],
        results JSONB,
        diff_report JSONB,
        stripe_session_id TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        migration_id UUID REFERENCES migrations(id),
        category TEXT,
        status TEXT,
        source_count INT,
        migrated_count INT,
        failed_count INT,
        error_details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE migration_logs ADD COLUMN IF NOT EXISTS photos JSONB;
    `);

    await client.query(`
      ALTER TABLE migration_logs ADD COLUMN IF NOT EXISTS skipped_count INT DEFAULT 0;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS token_cache (
        client_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    // ── New columns for three-layer pricing ──────────────────────────────
    await client.query(`
      ALTER TABLE migrations ADD COLUMN IF NOT EXISTS selected_addons JSONB DEFAULT '[]';
    `);

    await client.query(`
      ALTER TABLE migrations ADD COLUMN IF NOT EXISTS pricing_mode TEXT DEFAULT 'flat_tier';
    `);

    // ── Retry rate limiting ────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE migrations ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
    `);

    // ── Email verification & password reset columns ────────────────────────
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expires TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    `);

    // ── Beta access columns ─────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_beta BOOLEAN DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_starts_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_expires_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_notes TEXT;
    `);
    // NOTE: is_admin column already added above with email verification columns

    // ── Beta invoices table ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS beta_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        stripe_invoice_id TEXT,
        description TEXT,
        amount_cents INT NOT NULL,
        due_date DATE,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Pilot mode: selected listing IDs ────────────────────────────────────
    await client.query(`
      ALTER TABLE migrations ADD COLUMN IF NOT EXISTS selected_listing_ids JSONB;
    `);

    // ── Track when migration actually started running ─────────────────────
    // created_at is the original creation date and can be months old for
    // reprocessed migrations.  started_at is stamped when the engine sets
    // status to 'running', giving the stuck-migration recovery an accurate
    // age signal so server restarts don't immediately kill active runs.
    await client.query(`
      ALTER TABLE migrations ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
    `);

    // ── Progress heartbeat ────────────────────────────────────────────────
    // last_progress_at is stamped by the migration engine whenever meaningful
    // work is completed (each API call, each listing created, each phase done).
    // The stuck-migration detector compares this against NOW() — if no progress
    // has been recorded in 15 minutes the migration is considered stalled and
    // is automatically failed so the user can reprocess.
    await client.query(`
      ALTER TABLE migrations ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;
    `);

    // ── ETL: Source data cache ─────────────────────────────────────────────
    // Stores raw source Guesty data extracted from the source account, one row
    // per (migration, category, source_id).
    //
    // category values:
    //   'listing'       — full listing JSON from source account
    //   'spaces'        — listing spaces array (from GET /listings/:id/spaces)
    //   'availability'  — listing availability settings object
    //   'calendar'      — calendar block day array (blocked dates)
    //
    // Data is extracted ONCE on first run and reused on all subsequent restarts,
    // eliminating repeated source API calls (the 21-min MTL scan, OAuth timeout
    // prone spaces fetches, etc.).
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_source_data (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        migration_id UUID REFERENCES migrations(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        source_id TEXT NOT NULL,
        data JSONB NOT NULL,
        extracted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS migration_source_data_lookup
        ON migration_source_data (migration_id, category, source_id);
    `);

    // ── ETL: Load log ─────────────────────────────────────────────────────
    // Tracks the load status of each item posted to the destination account,
    // one row per (migration, category, source_id).
    //
    // category values:
    //   'listing_create'    — listing created in destination
    //   'spaces_load'       — spaces applied to destination listing
    //   'availability_load' — availability settings applied to destination listing
    //   'calendar_load'     — calendar blocks applied to destination listing
    //
    // Replaces the fragile JSONB idMap blob with per-item DB tracking so that
    // a restart resumes from exactly where it left off at the listing level.
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_load_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        migration_id UUID REFERENCES migrations(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        source_id TEXT NOT NULL,
        dest_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        loaded_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS migration_load_log_lookup
        ON migration_load_log (migration_id, category, source_id);
    `);

    logger.info('Database migrations completed successfully');

    // ── Auto-seed admin from environment variables ──────────────────────────
    const adminEmail    = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      const hash = await bcrypt.hash(adminPassword, 12);
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, email_verified, is_admin)
         VALUES ($1, $2, true, true)
         ON CONFLICT (email) DO UPDATE
           SET password_hash  = EXCLUDED.password_hash,
               email_verified = true,
               is_admin       = true
         RETURNING id, email, is_admin`,
        [adminEmail, hash],
      );
      logger.info('Admin account ready', { email: rows[0].email, id: rows[0].id });
    }
  } finally {
    client.release();
  }
};

// Run migrations if called directly
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Migration failed', { error: err.message });
      process.exit(1);
    });
}

const purgeExpiredCredentials = async () => {
  try {
    const result = await pool.query(`
      UPDATE migrations
      SET source_client_id = NULL, source_client_secret = NULL,
          dest_client_id = NULL, dest_client_secret = NULL
      WHERE status IN ('complete', 'complete_with_errors', 'failed')
        AND completed_at < NOW() - INTERVAL '30 days'
        AND source_client_id IS NOT NULL
    `);
    if (result.rowCount > 0) {
      logger.info(`Purged credentials from ${result.rowCount} expired migration(s)`);
    }

    // Purge ETL source data and load log for old completed migrations (storage cleanup).
    // Retain for 30 days after completion in case the user needs to reprocess or debug.
    const etlResult = await pool.query(`
      DELETE FROM migration_source_data
      WHERE migration_id IN (
        SELECT id FROM migrations
        WHERE status IN ('complete', 'complete_with_errors', 'failed')
          AND completed_at < NOW() - INTERVAL '30 days'
      )
    `);
    const loadLogResult = await pool.query(`
      DELETE FROM migration_load_log
      WHERE migration_id IN (
        SELECT id FROM migrations
        WHERE status IN ('complete', 'complete_with_errors', 'failed')
          AND completed_at < NOW() - INTERVAL '30 days'
      )
    `);
    if ((etlResult.rowCount || 0) + (loadLogResult.rowCount || 0) > 0) {
      logger.info(`Purged ETL data: ${etlResult.rowCount} source rows, ${loadLogResult.rowCount} load log rows`);
    }
  } catch (err) {
    logger.error('Failed to purge expired credentials', { error: err.message });
  }
};

const purgeStalePendingMigrations = async () => {
  try {
    const result = await pool.query(
      `DELETE FROM migrations
       WHERE status = 'pending'
         AND created_at < NOW() - INTERVAL '24 hours'`
    );
    if (result.rowCount > 0) {
      logger.info(`Purged ${result.rowCount} stale pending migration(s)`);
    }
  } catch (err) {
    logger.error('Failed to purge stale pending migrations', { error: err.message });
  }
};

module.exports = { pool, migrate, purgeExpiredCredentials, purgeStalePendingMigrations };
