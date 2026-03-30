const express = require('express');
const { pool } = require('../db');
const { encrypt, decrypt } = require('../encryption');
const { authenticateToken } = require('../auth');
const GuestyClient = require('../guestyClient');
const { getTierFromListings, calculatePerListingCents, getAddonPriceMap } = require('../pricing');
const { logger } = require('../logger');
const { OperatorDeck } = require('../operatordeck');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

const ADDON_PRICE_MAP = getAddonPriceMap();

// ── POST /api/migrations/preflight ──────────────────────────────────────────

router.post('/preflight', async (req, res) => {
  try {
    // Check email verification before allowing migration
    const userResult = await pool.query(
      'SELECT email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!userResult.rows[0]?.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before starting a migration.' });
    }

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
      // Resolve account ID once (needed for the custom-fields path)
      const accountId = await sourceClient.getAccountId();

      // Fetch full listings (needed for photo count) and counts for the rest
      const [customFields, fees, allListings, rateStrategies, reservations, guests, owners, savedReplies, tasks] = await Promise.all([
        sourceClient.getCount(`/accounts/${accountId}/custom-fields`),
        sourceClient.getCount('/additional-fees/account'),
        sourceClient.getAllListings(),
        sourceClient.getCount('/revenue-management/rate-strategies'),
        sourceClient.getCount('/reservations'),
        sourceClient.getCount('/guests'),
        sourceClient.getCount('/owners'),
        sourceClient.getCount('/saved-replies'),
        sourceClient.getCount(`/tasks-open-api/tasks?columns=_id`),
      ]);

      // l.pictures is an array of picture objects, each with .original and/or
      // .thumbnail URLs (not plain strings). The count here is the total number
      // of picture objects across all listings; actual URL extraction happens in
      // the migration engine (see migrationEngine.js).
      const photoCount = allListings.reduce(
        (sum, l) => sum + (Array.isArray(l.pictures) ? l.pictures.length : 0), 0
      );

      manifest = {
        custom_fields: customFields,
        fees,
        listings: allListings.length,
        rate_strategies: rateStrategies,
        reservations,
        guests,
        owners,
        saved_replies: savedReplies,
        tasks,
        photos: photoCount,
        listingDetails: allListings.map(l => ({
          id:        l._id,
          title:     l.title || l.nickname || `Listing ${l._id}`,
          nickname:  l.nickname || null,
          type:      l.type || 'STL',
          complexId: l.complexId || null,
          city:      l.address?.city || null,
          isActive:  l.active !== false,
        })),
        pricing_snapshot_available: true,
      };
    } catch (err) {
      const details = err.response?.data?.message || err.message;
      logger.warn('Preflight source credential failure', {
        error: details,
        status: err.response?.status,
        userId: req.user.id,
      });
      return res.status(400).json({
        error: 'Failed to connect to source Guesty account',
        details,
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
      const details = err.response?.data?.message || err.message;
      logger.warn('Preflight destination credential failure', {
        error: details,
        status: err.response?.status,
        userId: req.user.id,
      });
      return res.status(400).json({
        error: 'Failed to connect to destination Guesty account',
        details,
      });
    }

    // Compute pricing based on listing count (6-tier model)
    const tierInfo = getTierFromListings(manifest.listings);
    const perListingCents = calculatePerListingCents(manifest.listings);

    // Persist migration row — encrypt ALL credential fields at rest
    const result = await pool.query(
      `INSERT INTO migrations (user_id, source_client_id, source_client_secret, dest_client_id, dest_client_secret, status, manifest)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING id`,
      [
        req.user.id,
        encrypt(sourceClientId),
        encrypt(sourceClientSecret),
        encrypt(destClientId),
        encrypt(destClientSecret),
        JSON.stringify(manifest),
      ]
    );

    // Build response
    const pricing = tierInfo.requiresQuote
      ? { tier: 'enterprise_plus', requiresQuote: true, perListingCents }
      : { tier: tierInfo.tier, amountCents: tierInfo.amountCents, perListingCents };

    OperatorDeck.event('migration.started', {
      migrationId: result.rows[0].id,
      userId: req.user.id,
      listings: manifest.listings,
      tier: tierInfo.tier,
    });
    res.json({
      migrationId: result.rows[0].id,
      manifest,
      pricing,
    });
  } catch (err) {
    logger.error('Preflight error', { error: err.message });
    OperatorDeck.error('migration.preflight_error', { message: err.message, stack: err.stack, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/migrations/:id/checkout ───────────────────────────────────────

router.post('/:id/checkout', async (req, res) => {
  try {
    const { id } = req.params;
    const { selectedCategories, pricingMode = 'flat_tier', addOns = [], selectedListingIds } = req.body;

    const migResult = await pool.query(
      'SELECT * FROM migrations WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found' });
    }

    const migration = migResult.rows[0];
    const manifest = migration.manifest;

    // Store selected listing IDs for pilot mode
    if (selectedListingIds && Array.isArray(selectedListingIds) && selectedListingIds.length > 0) {
      await pool.query(
        `UPDATE migrations SET selected_listing_ids = $1 WHERE id = $2`,
        [JSON.stringify(selectedListingIds), id]
      );
    }

    // ── Beta users bypass payment entirely ───────────────────────────────────────
    const betaCheck = await pool.query(
      `SELECT is_beta, beta_expires_at FROM users WHERE id = $1`,
      [req.user.id]
    );
    const betaUser = betaCheck.rows[0];
    if (betaUser?.is_beta && betaUser.beta_expires_at && new Date(betaUser.beta_expires_at) > new Date()) {
      // Beta user — skip payment, mark as paid, enqueue
      const betaBaseCats = selectedCategories || ['custom_fields', 'fees', 'listings', 'rate_strategies', 'guests', 'owners', 'saved_replies', 'reservations', 'tasks'];
      const betaAddOns = addOns || [];
      const betaFinalCats = betaAddOns.includes('pricing_snapshot')
        ? [...betaBaseCats, 'pricing_snapshot']
        : betaBaseCats;
      await pool.query(
        `UPDATE migrations SET status = 'paid', selected_categories = $1, selected_addons = $2, pricing_mode = 'beta' WHERE id = $3`,
        [
          betaFinalCats,
          JSON.stringify(betaAddOns),
          id,
        ]
      );
      const { enqueueMigration } = require('../queue');
      await enqueueMigration(id, { priority: 1 }); // Beta users get priority
      OperatorDeck.event('migration.beta_bypass', { migrationId: id, userId: req.user.id });
      return res.json({ betaBypassed: true, migrationId: id });
    }

    // Pilot mode: use selected listing count for pricing if present
    const effectiveListingCount = (selectedListingIds && Array.isArray(selectedListingIds) && selectedListingIds.length > 0)
      ? selectedListingIds.length
      : manifest.listings;

    // Block enterprise_plus from checkout
    const tierInfo = getTierFromListings(effectiveListingCount);
    if (tierInfo.requiresQuote) {
      return res.status(400).json({
        error: 'Accounts with 500+ listings require a custom quote. Please contact support.',
        requiresQuote: true,
      });
    }

    // ── Build Stripe line items ──────────────────────────────────────────
    const line_items = [];

    if (pricingMode === 'per_listing' || tierInfo.tier === 'per_listing') {
      // Per-listing pricing — compute total server-side, use price_data
      const totalCents = calculatePerListingCents(effectiveListingCount);
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
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Payment processing is not configured' });
    }
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/migrate?step=progress&migrationId=${id}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/migrate?step=payment&migrationId=${id}`,
      metadata: { migrationId: id },
    });

    // Build final category list — inject pricing_snapshot if opted in as an add-on
    const baseCats = selectedCategories || ['custom_fields', 'fees', 'listings', 'rate_strategies', 'guests', 'owners', 'saved_replies', 'reservations', 'tasks'];
    const finalCategories = validAddOns.includes('pricing_snapshot')
      ? [...baseCats, 'pricing_snapshot']
      : baseCats;

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
        finalCategories,
        JSON.stringify(validAddOns),
        pricingMode,
        id,
      ]
    );

    OperatorDeck.event('migration.checkout_created', {
      migrationId: id,
      userId: req.user.id,
      pricingMode,
      tier: tierInfo.tier,
      stripeSessionId: session.id,
    });
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error('Checkout error', { error: err.message });
    OperatorDeck.error('migration.checkout_error', { message: err.message, stack: err.stack, migrationId: id, userId: req.user.id });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ── GET /api/migrations/:id/resume ──────────────────────────────────────────
// Returns the manifest + pricing for a pending migration so the Review step
// can be pre-populated without re-entering credentials.

router.get('/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, manifest FROM migrations WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pending migration not found' });
    }
    const { manifest } = result.rows[0];
    const pricing = getTierFromListings(manifest?.listings ?? 0);
    res.json({ migrationId: id, manifest, pricing });
  } catch (err) {
    logger.error('Resume migration error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/migrations/:id ───────────────────────────────────────────────
// Allows a user to discard their own pending migration.

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM migrations WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
      [id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pending migration not found' });
    }
    OperatorDeck.event('migration.discarded', { migrationId: id, userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete migration error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
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
    logger.error('Status error', { error: err.message });
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
    logger.error('Report error', { error: err.message });
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

    const migration = migResult.rows[0];

    // Enforce max 3 retries
    if ((migration.retry_count || 0) >= 3) {
      return res.status(429).json({ error: 'Maximum retry limit reached' });
    }

    // Enforce 5-minute cooldown since last completion
    if (migration.completed_at) {
      const cooldownMs = 5 * 60 * 1000;
      const elapsed = Date.now() - new Date(migration.completed_at).getTime();
      if (elapsed < cooldownMs) {
        return res.status(429).json({ error: 'Please wait before retrying' });
      }
    }

    await pool.query(
      "UPDATE migrations SET status = 'paid', error_message = NULL, retry_count = retry_count + 1 WHERE id = $1",
      [id]
    );

    // Retain add-on priority for retries
    const addons = migration.selected_addons || [];
    const priority = addons.includes('priority') ? 1 : 10;

    const { enqueueMigration } = require('../queue');
    await enqueueMigration(id, { priority });
    OperatorDeck.event('migration.retry', { migrationId: id, userId: req.user.id, retryCount: (migration.retry_count || 0) + 1 });
    res.json({ success: true });
  } catch (err) {
    logger.error('Retry error', { error: err.message });
    OperatorDeck.error('migration.retry_error', { message: err.message, stack: err.stack, migrationId: id, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/migrations/:id/demo-activate — bypass payment for demo users
router.post('/:id/demo-activate', async (req, res) => {
  try {
    if (!req.user.is_demo) {
      return res.status(403).json({ error: 'Demo activation is only available for demo accounts' });
    }

    const { id } = req.params;
    const { selectedCategories, selectedListingIds } = req.body;

    const migResult = await pool.query(
      "SELECT * FROM migrations WHERE id = $1 AND user_id = $2 AND status = 'pending'",
      [id, req.user.id]
    );

    if (migResult.rows.length === 0) {
      return res.status(404).json({ error: 'Migration not found or already activated' });
    }

    const demoBaseCats = selectedCategories || ['custom_fields', 'fees', 'listings', 'rate_strategies', 'guests', 'owners', 'saved_replies', 'reservations', 'tasks'];
    await pool.query(
      "UPDATE migrations SET status = 'paid', selected_categories = $1, selected_listing_ids = $2 WHERE id = $3",
      [
        demoBaseCats,
        selectedListingIds ? JSON.stringify(selectedListingIds) : null,
        id,
      ]
    );

    const { enqueueMigration } = require('../queue');
    await enqueueMigration(id);

    res.json({ success: true });
  } catch (err) {
    logger.error('Demo activate error', { error: err.message });
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
    logger.error('List migrations error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
