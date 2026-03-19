const express = require('express');
const { pool } = require('../db');
const { encrypt, decrypt } = require('../encryption');
const { authenticateToken } = require('../auth');
const GuestyClient = require('../guestyClient');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// ── Pricing helpers ─────────────────────────────────────────────────────────

function getTierFromListings(count) {
  if (count <= 10)  return { tier: 'starter',        priceEnvKey: 'STRIPE_PRICE_STARTER',        amountCents: 14900 };
  if (count <= 50)  return { tier: 'growth',          priceEnvKey: 'STRIPE_PRICE_GROWTH',          amountCents: 34900 };
  if (count <= 150) return { tier: 'professional',    priceEnvKey: 'STRIPE_PRICE_PROFESSIONAL',    amountCents: 69900 };
  if (count <= 300) return { tier: 'business',        priceEnvKey: 'STRIPE_PRICE_BUSINESS',        amountCents: 99900 };
  if (count <= 500) return { tier: 'enterprise',      priceEnvKey: 'STRIPE_PRICE_ENTERPRISE',      amountCents: 149900 };
  return { tier: 'enterprise_plus', requiresQuote: true };
}

/**
 * Compute the per-listing graduated price in cents.
 *   Base fee: $79 flat
 *   Listings 1–50:  $8.00 each
 *   Listings 51–200: $5.00 each
 *   Listings 201+:  $3.00 each
 */
function calculatePerListingCents(listingCount) {
  const baseCents = 7900;
  let total = baseCents;
  const tier1 = Math.min(listingCount, 50);
  total += tier1 * 800;
  const tier2 = Math.min(Math.max(listingCount - 50, 0), 150);
  total += tier2 * 500;
  const tier3 = Math.max(listingCount - 200, 0);
  total += tier3 * 300;
  return total;
}

// Valid add-on keys → env var mapping
const ADDON_PRICE_MAP = {
  priority:   'STRIPE_PRICE_ADDON_PRIORITY',
  support:    'STRIPE_PRICE_ADDON_SUPPORT',
  remigrate:  'STRIPE_PRICE_ADDON_REMIGRATE',
  verify:     'STRIPE_PRICE_ADDON_VERIFY',
};

// ── POST /api/migrations/preflight ──────────────────────────────────────────

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
      const [customFields, fees, taxes, allListings, reservations, guests, owners, automations, tasks] = await Promise.all([
        sourceClient.getCount('/custom-fields'),
        sourceClient.getCount('/fees'),
        sourceClient.getCount('/taxes'),
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
        custom_fields: customFields,
        fees,
        taxes,
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

    // Compute pricing based on listing count (6-tier model)
    const tierInfo = getTierFromListings(manifest.listings);
    const perListingCents = calculatePerListingCents(manifest.listings);

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

    // Build response
    const pricing = tierInfo.requiresQuote
      ? { tier: 'enterprise_plus', requiresQuote: true, perListingCents }
      : { tier: tierInfo.tier, amountCents: tierInfo.amountCents, perListingCents };

    res.json({
      migrationId: result.rows[0].id,
      manifest,
      pricing,
    });
  } catch (err) {
    console.error('Preflight error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/migrations/:id/checkout ───────────────────────────────────────

router.post('/:id/checkout', async (req, res) => {
  try {
    const { id } = req.params;
    const { selectedCategories, pricingMode = 'flat_tier', addOns = [] } = req.body;

    const migResult = await pool.query(
      'SELECT * FROM migrations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const migration = migResult.rows[0];
    const manifest = migration.manifest;

    // Block enterprise_plus from checkout
    const tierInfo = getTierFromListings(manifest.listings);
    if (tierInfo.requiresQuote) {
      return res.status(400).json({
        error: 'Accounts with 500+ listings require a custom quote. Please contact support.',
        requiresQuote: true,
      });
    }

    // ── Build Stripe line items ──────────────────────────────────────────
    const line_items = [];

    if (pricingMode === 'per_listing') {
      // Per-listing graduated pricing — compute total server-side, use price_data
      const totalCents = calculatePerListingCents(manifest.listings);
      line_items.push({
        price_data: {
          currency: 'usd',
          product: process.env.STRIPE_PRODUCT_PER_LISTING,
          unit_amount: totalCents,
        },
        quantity: 1,
      });
    } else {
      // Flat-tier pricing — use pre-created Stripe Price ID
      const priceId = process.env[tierInfo.priceEnvKey];
      if (!priceId) {
        return res.status(500).json({ error: 'Stripe Price ID not configured for this tier' });
      }
      line_items.push({ price: priceId, quantity: 1 });
    }

    // Add-on line items
    const validAddOns = (addOns || []).filter((a) => ADDON_PRICE_MAP[a]);
    for (const addon of validAddOns) {
      const addonPriceId = process.env[ADDON_PRICE_MAP[addon]];
      if (addonPriceId) {
        line_items.push({ price: addonPriceId, quantity: 1 });
      }
    }

    // Create Stripe Checkout session
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/migrate?step=progress&migrationId=${id}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/migrate?step=payment&migrationId=${id}`,
      metadata: { migrationId: id },
    });

    // Persist session + selections
    await pool.query(
      `UPDATE migrations
         SET stripe_session_id = $1,
             selected_categories = $2,
             selected_addons = $3,
             pricing_mode = $4
       WHERE id = $5`,
      [
        session.id,
        selectedCategories || ['custom_fields', 'fees', 'taxes', 'listings', 'guests', 'owners', 'reservations', 'automations', 'tasks'],
        JSON.stringify(validAddOns),
        pricingMode,
        id,
      ]
    );

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ── GET /api/migrations/:id/status ──────────────────────────────────────────

router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;

    const migResult = await pool.query(
      'SELECT id, status, manifest, selected_categories, selected_addons, pricing_mode, results, diff_report, error_message, created_at, completed_at FROM migrations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const logsResult = await pool.query(
      'SELECT category, status, source_count, migrated_count, failed_count, skipped_count, error_details, photos, created_at FROM migration_logs WHERE migration_id = $1 ORDER BY created_at ASC',
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

// ── GET /api/migrations/:id/report ──────────────────────────────────────────

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

// ── POST /api/migrations/:id/retry ──────────────────────────────────────────

router.post('/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    const migResult = await pool.query(
      "SELECT * FROM migrations WHERE id = $1 AND user_id = $2 AND status IN ('failed', 'complete_with_errors')",
      [id, req.user.id]
    );
    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found or not retryable' });
    }
    await pool.query(
      "UPDATE migrations SET status = 'paid', error_message = NULL WHERE id = $1",
      [id]
    );

    // Retain add-on priority for retries
    const migration = migResult.rows[0];
    const addons = migration.selected_addons || [];
    const priority = addons.includes('priority') ? 1 : 10;

    const { enqueueMigration } = require('../queue');
    await enqueueMigration(id, { priority });
    res.json({ success: true });
  } catch (err) {
    console.error('Retry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/migrations — list user's migrations ────────────────────────────

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, status, manifest, selected_categories, selected_addons, pricing_mode, results, diff_report, created_at, completed_at FROM migrations WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ migrations: result.rows });
  } catch (err) {
    console.error('List migrations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
