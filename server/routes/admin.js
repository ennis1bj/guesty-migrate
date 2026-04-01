const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireAdmin } = require('../auth');
const { logger } = require('../logger');
const { decrypt } = require('../encryption');
const GuestyClient = require('../guestyClient');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken);
router.use(requireAdmin);

// ── GET /api/admin/beta — list all beta participants ────────────────────────

router.get('/beta', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.is_beta,
        u.beta_starts_at,
        u.beta_expires_at,
        u.beta_notes,
        CASE
          WHEN u.is_beta AND u.beta_expires_at > NOW() THEN 'active'
          WHEN u.is_beta AND u.beta_expires_at <= NOW() THEN 'expired'
          ELSE 'inactive'
        END AS beta_status,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', bi.id,
            'stripe_invoice_id', bi.stripe_invoice_id,
            'description', bi.description,
            'amount_cents', bi.amount_cents,
            'due_date', bi.due_date,
            'status', bi.status,
            'created_at', bi.created_at
          )) FROM beta_invoices bi WHERE bi.user_id = u.id),
          '[]'::json
        ) AS invoices
      FROM users u
      WHERE u.is_beta = true OR EXISTS (SELECT 1 FROM beta_invoices bi WHERE bi.user_id = u.id)
      ORDER BY u.beta_starts_at DESC NULLS LAST
    `);

    res.json({ participants: result.rows });
  } catch (err) {
    logger.error('Admin beta list error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/beta/grant — grant beta access to a user ────────────────

router.post('/beta/grant', async (req, res) => {
  try {
    const { email, startsAt, expiresAt, notes } = req.body;

    if (!email || !expiresAt) {
      return res.status(400).json({ error: 'email and expiresAt are required' });
    }

    const userResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;
    const starts = startsAt || new Date().toISOString();

    await pool.query(
      `UPDATE users SET is_beta = true, beta_starts_at = $1, beta_expires_at = $2, beta_notes = $3,
       email_verified = true, verify_token = NULL, verify_token_expires = NULL WHERE id = $4`,
      [starts, expiresAt, notes || null, userId]
    );

    logger.info('Beta access granted', { adminId: req.user.id, targetUserId: userId, email, expiresAt });

    res.json({ success: true, userId, email, betaStartsAt: starts, betaExpiresAt: expiresAt });
  } catch (err) {
    logger.error('Admin beta grant error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/beta/:userId/extend — extend beta access ────────────────

router.post('/beta/:userId/extend', async (req, res) => {
  try {
    const { userId } = req.params;
    const { expiresAt, notes } = req.body;

    if (!expiresAt) {
      return res.status(400).json({ error: 'expiresAt is required' });
    }

    const result = await pool.query(
      `UPDATE users SET beta_expires_at = $1, beta_notes = COALESCE($2, beta_notes) WHERE id = $3 AND is_beta = true RETURNING id, email, beta_expires_at`,
      [expiresAt, notes || null, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Beta user not found' });
    }

    logger.info('Beta access extended', { adminId: req.user.id, targetUserId: userId, newExpiresAt: expiresAt });

    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    logger.error('Admin beta extend error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/beta/:userId/revoke — revoke beta access ────────────────

router.post('/beta/:userId/revoke', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `UPDATE users SET is_beta = false, beta_expires_at = NOW() WHERE id = $1 RETURNING id, email`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info('Beta access revoked', { adminId: req.user.id, targetUserId: userId });

    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    logger.error('Admin beta revoke error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/beta/:userId/invoice — create a custom Stripe invoice ───

router.post('/beta/:userId/invoice', async (req, res) => {
  try {
    const { userId } = req.params;
    const { description, amountCents, dueDate } = req.body;

    if (!description || !amountCents || amountCents <= 0) {
      return res.status(400).json({ error: 'description and a positive amountCents are required' });
    }

    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // ── Stripe invoice creation ─────────────────────────────────────────
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Find or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const newCustomer = await stripe.customers.create({ email: user.email });
      customerId = newCustomer.id;
    }

    // Create invoice item
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: amountCents,
      currency: 'usd',
      description,
    });

    // Create invoice
    const invoiceParams = {
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 30,
      auto_advance: true,
    };

    if (dueDate) {
      const dueDateObj = new Date(dueDate);
      const now = new Date();
      const diffDays = Math.max(1, Math.ceil((dueDateObj - now) / (1000 * 60 * 60 * 24)));
      invoiceParams.days_until_due = diffDays;
    }

    const invoice = await stripe.invoices.create(invoiceParams);

    // Finalize and send
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(finalizedInvoice.id);

    // Track in our database
    await pool.query(
      `INSERT INTO beta_invoices (user_id, stripe_invoice_id, description, amount_cents, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, finalizedInvoice.id, description, amountCents, dueDate || null, 'open']
    );

    logger.info('Beta invoice created', {
      adminId: req.user.id,
      targetUserId: userId,
      stripeInvoiceId: finalizedInvoice.id,
      amountCents,
    });

    res.json({
      success: true,
      invoiceId: finalizedInvoice.id,
      invoiceUrl: finalizedInvoice.hosted_invoice_url,
      status: 'open',
    });
  } catch (err) {
    logger.error('Admin beta invoice error', { error: err.message });
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// ── GET /api/admin/migrations/:id — full migration detail (admin only) ────────

router.get('/migrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, user_id, status, results, error_message, selected_listing_ids,
              pricing_mode, started_at, completed_at, last_progress_at, created_at
       FROM migrations WHERE id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }
    res.json({ migration: result.rows[0] });
  } catch (err) {
    logger.error('Admin get migration error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/migrations/:id/cancel — force-fail a running migration ──

router.post('/migrations/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE migrations
       SET status = 'failed', error_message = 'Cancelled by admin', completed_at = NOW()
       WHERE id = $1
       RETURNING id, status`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }
    logger.info('Migration cancelled by admin', { migrationId: id, adminId: req.user.id });
    res.json({ ok: true, migration: result.rows[0] });
  } catch (err) {
    logger.error('Admin cancel migration error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/migrations/:id/reprocess — update selection & re-queue ──

router.post('/migrations/:id/reprocess', async (req, res) => {
  try {
    const { id } = req.params;
    const { selectedListingIds } = req.body;
    if (!Array.isArray(selectedListingIds) || selectedListingIds.length === 0) {
      return res.status(400).json({ error: 'selectedListingIds must be a non-empty array' });
    }
    const result = await pool.query(
      `UPDATE migrations
       SET selected_listing_ids = $1,
           status = 'paid',
           results = NULL,
           error_message = NULL,
           completed_at = NULL,
           retry_count = 0
       WHERE id = $2
       RETURNING id, status, selected_listing_ids`,
      [JSON.stringify(selectedListingIds), id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }
    // Clear migration_logs so the engine does not skip categories it sees
    // as "already migrated in prior run" — reprocess must run everything fresh.
    await pool.query('DELETE FROM migration_logs WHERE migration_id = $1', [id]);
    const { enqueueMigration } = require('../queue');
    await enqueueMigration(id, { priority: 1 });
    logger.info('Migration reprocessed by admin', { migrationId: id, adminId: req.user.id, listingCount: selectedListingIds.length });
    res.json({ ok: true, migration: result.rows[0] });
  } catch (err) {
    logger.error('Admin reprocess migration error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/migrations/:id/retry — re-queue preserving idMap ─────────
// Unlike /reprocess (which wipes results+logs for a full restart), /retry keeps
// existing results and migration_logs intact so the engine can resume a partial
// migration — only categories with status 'partial' are re-run, and already-
// created items within those categories are skipped via the stored idMap.

router.post('/migrations/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE migrations
       SET status = 'paid',
           error_message = NULL,
           completed_at = NULL,
           retry_count = retry_count + 1
       WHERE id = $1
       RETURNING id, status, retry_count`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }
    const { enqueueMigration } = require('../queue');
    await enqueueMigration(id, { priority: 1 });
    logger.info('Migration retried by admin (preserving idMap)', { migrationId: id, adminId: req.user.id });
    res.json({ ok: true, migration: result.rows[0] });
  } catch (err) {
    logger.error('Admin retry migration error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/admin/migrations/:id/fix-listing-subresources ──────────────────
// Backfills spaces + availability-settings for listings already created in the
// destination account.  Runs async in the background; returns immediately.
// Use when listings were created without these sub-resources (causing Guesty
// dashboard errors) and a full reprocess is not desired.

router.post('/migrations/:id/fix-listing-subresources', async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch full migration row including encrypted credentials and stored idMap
    const migResult = await pool.query(
      `SELECT source_client_id, source_client_secret,
              dest_client_id, dest_client_secret, results
       FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }
    const row = migResult.rows[0];
    const idMap = row.results?.listings?.idMap || {};
    const pairs = Object.entries(idMap);
    if (pairs.length === 0) {
      return res.status(400).json({ error: 'No listings idMap found in migration results' });
    }

    const sourceClient = new GuestyClient({
      clientId: decrypt(row.source_client_id),
      clientSecret: decrypt(row.source_client_secret),
    });
    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // Respond immediately — the fix runs async in the background
    res.json({ ok: true, queued: true, listingCount: pairs.length });

    // ── Background fix ─────────────────────────────────────────────────────
    const { stripFieldsDeep } = require('../migrationEngine');
    const log = logger.child({ migrationId: id, op: 'fix-listing-subresources' });
    log.info(`Starting spaces + availability-settings backfill for ${pairs.length} listings`);

    let spaceOk = 0, spaceSkip = 0, spaceFail = 0;
    let availOk = 0, availFail = 0;

    await Promise.allSettled(
      pairs.map(async ([srcId, destId]) => {
        // Spaces
        try {
          const spaces = await sourceClient.getListingSpaces(srcId);
          if (Array.isArray(spaces) && spaces.length > 0) {
            for (const space of spaces) {
              const cleaned = stripFieldsDeep(space);
              try {
                await destClient.createListingSpace(destId, cleaned);
                spaceOk++;
              } catch (spErr) {
                if (spErr.response?.status === 409) { spaceSkip++; }
                else { spaceFail++; log.warn(`space create failed dest=${destId}`, { error: spErr.response?.data?.message || spErr.message }); }
              }
            }
          } else {
            spaceSkip++;
          }
        } catch (err) {
          spaceFail++;
          log.warn(`spaces fetch failed src=${srcId}`, { error: err.message });
        }

        // Availability settings
        try {
          const avail = await sourceClient.getListingAvailabilitySettings(srcId);
          if (avail && typeof avail === 'object') {
            const cleaned = stripFieldsDeep(avail);
            try {
              await destClient.updateListingAvailabilitySettings(destId, cleaned);
              availOk++;
            } catch (avErr) {
              availFail++;
              log.warn(`availability-settings update failed dest=${destId}`, { error: avErr.response?.data?.message || avErr.message });
            }
          }
        } catch (err) {
          availFail++;
          log.warn(`availability-settings fetch failed src=${srcId}`, { error: err.message });
        }
      })
    );

    log.info(`Backfill complete`, { spaceOk, spaceSkip, spaceFail, availOk, availFail });
  } catch (err) {
    logger.error('Admin fix-listing-subresources error', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/admin/users/search — search users by email ─────────────────────

router.get('/users/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const result = await pool.query(
      `SELECT id, email, is_beta, beta_expires_at, is_admin, created_at FROM users WHERE email ILIKE $1 LIMIT 20`,
      [`%${q}%`]
    );

    res.json({ users: result.rows });
  } catch (err) {
    logger.error('Admin user search error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
