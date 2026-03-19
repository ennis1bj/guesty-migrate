const express = require('express');
const { pool } = require('../db');
const { encrypt, decrypt } = require('../encryption');
const { authenticateToken } = require('../auth');
const GuestyClient = require('../guestyClient');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// POST /api/migrations/preflight
router.post('/preflight', async (req, res) => {
  try {
    const { sourceClientId, sourceClientSecret, destClientId, destClientSecret } = req.body;

    if (!sourceClientId || !sourceClientSecret || !destClientId || !destClientSecret) {
      return res.status(400).json({ error: 'All credential fields are required' });
    }

    // Validate source credentials
    const sourceClient = new GuestyClient({
      clientId: sourceClientId,
      clientSecret: sourceClientSecret,
    });

    let manifest;
    try {
      await sourceClient.getAccessToken();

      // Fetch full listings (needed for photo count) and counts for the rest
      const [allListings, reservations, guests, owners, automations, tasks] = await Promise.all([
        sourceClient.getAllListings(),
        sourceClient.getCount('/reservations'),
        sourceClient.getCount('/guests'),
        sourceClient.getCount('/owners'),
        sourceClient.getCount('/automations'),
        sourceClient.getCount('/tasks-open-api/tasks'),
      ]);

      const photoCount = allListings.reduce(
        (sum, l) => sum + (Array.isArray(l.pictures) ? l.pictures.length : 0), 0
      );

      manifest = {
        listings: allListings.length,
        reservations,
        guests,
        owners,
        automations,
        tasks,
        photos: photoCount,
      };
    } catch (err) {
      return res.status(400).json({
        error: 'Failed to connect to source Guesty account',
        details: err.response?.data?.message || err.message,
      });
    }

    // Validate destination credentials
    const destClient = new GuestyClient({
      clientId: destClientId,
      clientSecret: destClientSecret,
    });

    try {
      await destClient.getAccessToken();
    } catch (err) {
      return res.status(400).json({
        error: 'Failed to connect to destination Guesty account',
        details: err.response?.data?.message || err.message,
      });
    }

    // Compute pricing based on listing count
    let tier, amountCents;
    if (manifest.listings <= 10) {
      tier = 'starter';
      amountCents = 9900;
    } else if (manifest.listings <= 50) {
      tier = 'professional';
      amountCents = 29900;
    } else {
      tier = 'enterprise';
      amountCents = 59900;
    }

    // Persist migration row
    const result = await pool.query(
      `INSERT INTO migrations (user_id, source_client_id, source_client_secret, dest_client_id, dest_client_secret, status, manifest)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING id`,
      [
        req.user.id,
        sourceClientId,
        encrypt(sourceClientSecret),
        destClientId,
        encrypt(destClientSecret),
        JSON.stringify(manifest),
      ]
    );

    res.json({
      migrationId: result.rows[0].id,
      manifest,
      pricing: { tier, amountCents },
    });
  } catch (err) {
    console.error('Preflight error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/migrations/:id/checkout
router.post('/:id/checkout', async (req, res) => {
  try {
    const { id } = req.params;
    const { selectedCategories } = req.body;

    const migResult = await pool.query(
      'SELECT * FROM migrations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const migration = migResult.rows[0];
    const manifest = migration.manifest;

    // Compute pricing
    let amountCents;
    if (manifest.listings <= 10) {
      amountCents = 9900;
    } else if (manifest.listings <= 50) {
      amountCents = 29900;
    } else {
      amountCents = 59900;
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'GuestyMigrate — Account Migration',
              description: `Migrate ${manifest.listings} listings and associated data`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/migrate?step=progress&migrationId=${id}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/migrate?step=payment&migrationId=${id}`,
      metadata: { migrationId: id },
    });

    await pool.query(
      'UPDATE migrations SET stripe_session_id = $1, selected_categories = $2 WHERE id = $3',
      [session.id, selectedCategories || ['listings', 'guests', 'owners', 'reservations', 'automations', 'tasks'], id]
    );

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// GET /api/migrations/:id/status
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;

    const migResult = await pool.query(
      'SELECT id, status, manifest, selected_categories, results, diff_report, error_message, created_at, completed_at FROM migrations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const logsResult = await pool.query(
      'SELECT category, status, source_count, migrated_count, failed_count, error_details, created_at FROM migration_logs WHERE migration_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({
      ...migResult.rows[0],
      logs: logsResult.rows,
    });
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/migrations/:id/report
router.get('/:id/report', async (req, res) => {
  try {
    const { id } = req.params;

    const migResult = await pool.query(
      'SELECT diff_report FROM migrations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    res.json({ diffReport: migResult.rows[0].diff_report });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/migrations/:id/retry
router.post('/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    const migResult = await pool.query(
      "SELECT * FROM migrations WHERE id = $1 AND user_id = $2 AND status IN ('failed','complete_with_errors')",
      [id, req.user.id]
    );
    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found or not retryable' });
    }
    await pool.query(
      "UPDATE migrations SET status = 'paid', error_message = NULL WHERE id = $1",
      [id]
    );
    const { enqueueMigration } = require('../queue');
    await enqueueMigration(id);
    res.json({ success: true });
  } catch (err) {
    console.error('Retry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/migrations — list user's migrations
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, status, manifest, selected_categories, results, diff_report, created_at, completed_at FROM migrations WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ migrations: result.rows });
  } catch (err) {
    console.error('List migrations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
