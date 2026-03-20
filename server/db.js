const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required but not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
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
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    `);

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

    console.log('Database migrations completed successfully');
  } finally {
    client.release();
  }
};

// Run migrations if called directly
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { pool, migrate };
