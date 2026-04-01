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

// ── GET /api/admin/migrations/:id/diagnose-listings ──────────────────────────
// Read-only diagnostic: fetch destination parent + 5 sample sub-units and
// return their key MTL fields (type, listingType, parentId, complexId, title).
router.get('/migrations/:id/diagnose-listings', async (req, res) => {
  try {
    const { id } = req.params;
    const migResult = await pool.query(
      `SELECT dest_client_id, dest_client_secret, results FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const row = migResult.rows[0];
    const idMap = row.results?.listings?.idMap || {};
    const SOURCE_PARENT_ID = '63779e9e778ddc00302697ba';
    const destParentId = idMap[SOURCE_PARENT_ID];

    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // Fetch parent
    const parent = destParentId ? await destClient.getListingById(destParentId) : null;

    // Sample 5 sub-unit dest IDs
    const subEntries = Object.entries(idMap)
      .filter(([srcId]) => srcId !== SOURCE_PARENT_ID)
      .slice(0, 5);
    const subSamples = await Promise.allSettled(
      subEntries.map(async ([srcId, destId]) => {
        const l = await destClient.getListingById(destId);
        return {
          srcId, destId,
          allKeys: l ? Object.keys(l).sort() : null,
          type: l?.type,
          listingType: l?.listingType,
          parentId: l?.parentId,
          complexId: l?.complexId,
          parentListingId: l?.parentListingId,
          mtlParentId: l?.mtlParentId,
          mtl: l?.mtl,
          picturesManagedFromParent: l?.picturesManagedFromParent,
          title: l?.title,
        };
      })
    );

    // Return full raw parent + one sub-unit for field-name discovery
    const firstSub = subSamples[0]?.status === 'fulfilled'
      ? subSamples[0].value._raw
      : null;

    res.json({
      destParentId,
      parentAllKeys: parent ? Object.keys(parent).sort() : null,
      parent: parent ? {
        type: parent.type,
        listingType: parent.listingType,
        parentId: parent.parentId,
        complexId: parent.complexId,
        subListingsIds: parent.subListingsIds,
        subListingsIdsCount: Array.isArray(parent.subListingsIds) ? parent.subListingsIds.length : null,
        mtl: parent.mtl,
        title: parent.title,
      } : null,
      subUnitSamples: subSamples.map(r =>
        r.status === 'fulfilled' ? r.value : { error: r.reason?.message }
      ),
    });
  } catch (err) {
    logger.error('diagnose-listings error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/migrations/:id/fix-mtl-relationships ─────────────────────
// Backfills mtl.c on parent listings (children list) and mtl.p on sub-unit
// listings (parent back-ref) with correctly remapped DESTINATION IDs.
// Fixes "units not assigned" in Guesty's Details & Layout dashboard view.
// Runs async; returns 202 immediately.
router.post('/migrations/:id/fix-mtl-relationships', async (req, res) => {
  try {
    const { id } = req.params;
    const migResult = await pool.query(
      `SELECT source_client_id, source_client_secret, dest_client_id, dest_client_secret, results FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    const row = migResult.rows[0];
    const idMap = row.results?.listings?.idMap || {};
    if (Object.keys(idMap).length === 0) {
      return res.status(400).json({ error: 'No listing idMap found in migration results' });
    }

    res.status(202).json({ message: 'mtl relationship backfill started', totalListings: Object.keys(idMap).length });

    // ── async work ────────────────────────────────────────────────────────────
    const log = logger.child({ migrationId: id, op: 'fix-mtl-relationships' });
    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // Build reverse map: destId → srcId
    const reversedIdMap = Object.fromEntries(Object.entries(idMap).map(([k, v]) => [v, k]));

    // Source client — needed to read parentId from source listings
    // May be null if credentials were cleared post-migration; handled in step 2 fallback.
    let sourceClient = null;
    if (row.source_client_id && row.source_client_secret) {
      try {
        sourceClient = new GuestyClient({
          clientId: decrypt(row.source_client_id),
          clientSecret: decrypt(row.source_client_secret),
        });
      } catch (e) {
        log.warn('Could not initialise source client', { error: e.message });
      }
    }

    // Step 1: classify destination listings by type
    const destIds = Object.values(idMap);
    log.info(`Fetching ${destIds.length} destination listings to classify`);

    const listings = (await Promise.allSettled(
      destIds.map(async destId => {
        const l = await destClient.getListingById(destId);
        return l ? { destId, srcId: reversedIdMap[destId], type: l.type, mtl: l.mtl } : null;
      })
    )).flatMap(r => (r.status === 'fulfilled' && r.value ? [r.value] : []));

    const parents  = listings.filter(l => l.type === 'MTL');
    const subUnits = listings.filter(l => l.type === 'MTL_CHILD');
    const typeCounts = listings.reduce((acc, l) => { acc[l.type || 'unknown'] = (acc[l.type || 'unknown'] || 0) + 1; return acc; }, {});
    log.info(`Classified: ${parents.length} parent(s), ${subUnits.length} sub-unit(s)`, { typeCounts });

    if (parents.length === 0) { log.warn('No MTL parent listings found — aborting'); return; }

    // Step 2: for each sub-unit fetch its SOURCE listing to get the correct parentId,
    // then map that source parentId → destination parentId via idMap.
    log.info(`Fetching ${subUnits.length} source sub-unit listings to resolve parentId`);
    const subUnitParentMap = new Map(); // destSubId → destParentId
    await Promise.allSettled(
      subUnits.map(async sub => {
        if (!sub.srcId || !sourceClient) return;
        try {
          const srcListing = await sourceClient.getListingById(sub.srcId);
          const srcParentId = srcListing?.parentId;
          if (!srcParentId) return;
          const destParentId = idMap[srcParentId];
          if (destParentId) {
            subUnitParentMap.set(sub.destId, destParentId);
          } else {
            // parentId not in idMap — fall back to matching by type MTL if only one parent
            if (parents.length === 1) subUnitParentMap.set(sub.destId, parents[0].destId);
          }
        } catch (err) {
          log.warn(`Could not fetch source listing for sub-unit`, { srcId: sub.srcId, error: err.message });
          if (parents.length === 1) subUnitParentMap.set(sub.destId, parents[0].destId);
        }
      })
    );
    log.info(`Resolved parentId for ${subUnitParentMap.size}/${subUnits.length} sub-units`);

    // Step 3: build per-parent child lists
    const parentChildMap = new Map(parents.map(p => [p.destId, []]));
    for (const [destSubId, destParentId] of subUnitParentMap) {
      if (parentChildMap.has(destParentId)) parentChildMap.get(destParentId).push(destSubId);
    }

    // Step 4: patch each parent's mtl.c
    const results = { parents: [], subUnits: {} };
    for (const parent of parents) {
      const childIds = parentChildMap.get(parent.destId) || [];
      if (!parent.mtl) {
        results.parents.push({ destId: parent.destId, status: 'skipped_no_mtl' });
        continue;
      }
      try {
        await destClient.updateListing(parent.destId, { mtl: { ...parent.mtl, c: childIds } });
        log.info(`mtl.c patched on parent`, { destId: parent.destId, childCount: childIds.length });
        results.parents.push({ destId: parent.destId, status: 'ok', childCount: childIds.length });
      } catch (err) {
        log.warn(`mtl.c PATCH failed for parent`, { destId: parent.destId, error: err.message });
        results.parents.push({ destId: parent.destId, status: 'error', error: err.message });
      }
    }

    // Step 5: patch each sub-unit's mtl.p (and reset mtl.c to [] to undo any previous bad run)
    let ok = 0; let failed = 0;
    for (const sub of subUnits) {
      const destParentId = subUnitParentMap.get(sub.destId);
      if (!destParentId) { log.warn(`No destParentId for sub-unit ${sub.destId} — skipping`); failed++; continue; }
      if (!sub.mtl) { log.warn(`Sub-unit ${sub.destId} has no mtl — skipping`); failed++; continue; }
      try {
        await destClient.updateListing(sub.destId, { mtl: { ...sub.mtl, p: destParentId, c: [] } });
        ok++;
      } catch (err) {
        log.warn(`mtl.p PATCH failed for sub-unit ${sub.destId}`, { error: err.message });
        failed++;
      }
    }
    log.info(`Sub-unit mtl.p patch complete`, { ok, failed });
    results.subUnits = { ok, failed };

    log.info('fix-mtl-relationships complete', results);
  } catch (err) {
    logger.error('fix-mtl-relationships error', { error: err.message });
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
    const log = logger.child({ migrationId: id, op: 'fix-listing-subresources' });
    log.info(`Starting complexId-clear + availability-settings backfill for ${pairs.length} listings`);

    // ── Constants ───────────────────────────────────────────────────────────
    const SOURCE_PARENT_ID = '63779e9e778ddc00302697ba';
    const STALE_COMPLEX_ID  = '6724e1f4227b66e41755179f'; // source-account entity — invalid in dest
    const destParentId      = idMap[SOURCE_PARENT_ID];

    let complexClearOk = 0, complexClearFail = 0, complexUpdateOk = 0, complexUpdateFail = 0;
    let availOk = 0, availFail = 0;
    let subListingsOk = false, roomsInfoOk = false;

    // ── Step 1: Clear orphaned complexId on the PARENT listing ──────────────
    // When the MTL parent was created, we forwarded the source account's complexId.
    // That complex entity does not exist in the destination account, so Guesty's
    // dashboard returns a 404 when trying to resolve it → UI error.
    // Clearing it (null) should prompt Guesty to auto-assign a valid destination
    // complex entity.
    let newComplexId = null;
    if (destParentId) {
      try {
        log.info(`Clearing complexId on parent`, { destParentId, staleComplexId: STALE_COMPLEX_ID });
        await destClient.updateListing(destParentId, { complexId: null });
        // Wait briefly then re-fetch to see what Guesty assigned
        await new Promise(r => setTimeout(r, 2000));
        const refreshed = await destClient.getListingById(destParentId);
        newComplexId = refreshed?.complexId || null;
        log.info(`Parent complexId after clear`, { destParentId, newComplexId });
        complexClearOk++;
      } catch (err) {
        complexClearFail++;
        log.warn(`complexId clear failed on parent`, {
          destParentId,
          status: err.response?.status,
          error: err.response?.data?.message || err.message,
        });
      }
    } else {
      log.warn(`Source parent ${SOURCE_PARENT_ID} not found in idMap — cannot clear complexId`);
    }

    // ── Step 2: Update all sub-units to use the (new or cleared) complexId ──
    // If Guesty auto-assigned a proper complexId to the parent, propagate it to
    // all sub-units.  If complexId came back null (Guesty didn't auto-assign),
    // we still clear the stale value so it's no longer an orphaned reference.
    const subUnitPairs = pairs.filter(([srcId]) => srcId !== SOURCE_PARENT_ID);
    const CONCURRENCY = 10;
    for (let i = 0; i < subUnitPairs.length; i += CONCURRENCY) {
      const chunk = subUnitPairs.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async ([, destId]) => {
          try {
            await destClient.updateListing(destId, { complexId: newComplexId });
            complexUpdateOk++;
          } catch (err) {
            complexUpdateFail++;
            log.warn(`complexId update failed on sub-unit`, {
              destId,
              status: err.response?.status,
              error: err.response?.data?.message || err.message,
            });
          }
        })
      );
    }

    // ── Step 3: Fix availability-settings on PARENT only ────────────────────
    // Guesty rejects availability-settings updates on MTL_CHILD listings
    // ("must update parent unit").  Only the parent gets the PUT.
    // Correct payload format: { calendarRules: { ... } } — wrapping is required.
    if (destParentId) {
      try {
        await destClient.updateListingAvailabilitySettings(destParentId, {
          calendarRules: {
            defaultAvailability: 'available',
            advanceNotice: 1,
            preparationTime: 0,
            checkIn: { from: '15:00', to: '23:00' },
            checkOut: { until: '11:00' },
            minimumStay: 1,
          },
        });
        availOk++;
        log.info(`availability-settings updated on parent`, { destParentId });
      } catch (avErr) {
        availFail++;
        log.warn(`availability-settings update failed on parent`, {
          destParentId,
          status: avErr.response?.status,
          error: avErr.response?.data?.message || avErr.message,
        });
      }
    }

    // ── Step 4: Remap subListingsIds on the MTL parent ──────────────────────
    // The parent was created with SOURCE sub-unit IDs in subListingsIds (they
    // were not in SOURCE_ONLY_FIELDS at migration time).  Guesty's
    // "Details and Layout" reads this array to show assigned units.
    // Replace it with destination sub-unit IDs derived from the idMap.
    if (destParentId) {
      const destSubUnitIds = Object.entries(idMap)
        .filter(([srcId]) => srcId !== SOURCE_PARENT_ID)
        .map(([, destId]) => destId)
        .filter(Boolean);
      log.info(`Patching subListingsIds on parent`, {
        destParentId,
        count: destSubUnitIds.length,
      });
      try {
        await destClient.updateListing(destParentId, { subListingsIds: destSubUnitIds });
        subListingsOk = true;
        log.info(`subListingsIds patched successfully`, { destParentId, count: destSubUnitIds.length });
      } catch (err) {
        log.warn(`subListingsIds PATCH failed`, {
          destParentId,
          status: err.response?.status,
          error: err.response?.data?.message || err.message,
        });
      }

      // ── Step 5: Copy roomsInfo from source parent → destination parent ────
      // The destination parent's roomsInfo is null (confirmed by diagnostic).
      // Fetch the source parent to check if roomsInfo exists there.
      // If it does, PATCH the destination with it so the "Details and Layout"
      // section in Guesty's dashboard shows the correct bathroom/bedroom info.
      try {
        const srcParent = await sourceClient.getListingById(SOURCE_PARENT_ID);
        log.info(`Source parent diagnostic`, {
          srcParentId: SOURCE_PARENT_ID,
          bathrooms: srcParent?.bathrooms ?? 'MISSING',
          bedrooms: srcParent?.bedrooms ?? 'MISSING',
          accommodates: srcParent?.accommodates ?? 'MISSING',
          roomsInfoCount: Array.isArray(srcParent?.roomsInfo) ? srcParent.roomsInfo.length : 'MISSING',
          propertyType: srcParent?.propertyType ?? 'MISSING',
        });

        // Build a PATCH payload with all room/property layout fields
        const layoutPatch = {};
        if (typeof srcParent?.bathrooms === 'number') layoutPatch.bathrooms = srcParent.bathrooms;
        if (typeof srcParent?.bedrooms === 'number') layoutPatch.bedrooms = srcParent.bedrooms;
        if (typeof srcParent?.accommodates === 'number') layoutPatch.accommodates = srcParent.accommodates;
        if (Array.isArray(srcParent?.roomsInfo) && srcParent.roomsInfo.length > 0) {
          const { stripFieldsDeep } = require('../migrationEngine');
          layoutPatch.roomsInfo = stripFieldsDeep(srcParent.roomsInfo);
        }
        if (srcParent?.propertyType) {
          // propertyType can be a plain string ("Condominium") or an object
          if (typeof srcParent.propertyType === 'object') {
            const { stripFieldsDeep } = require('../migrationEngine');
            layoutPatch.propertyType = stripFieldsDeep(srcParent.propertyType);
          } else {
            layoutPatch.propertyType = srcParent.propertyType;
          }
        }

        if (Object.keys(layoutPatch).length > 0) {
          try {
            await destClient.updateListing(destParentId, layoutPatch);
            roomsInfoOk = true;
            log.info(`Layout fields patched on destination parent`, {
              destParentId,
              fields: Object.keys(layoutPatch),
            });
          } catch (patchErr) {
            log.warn(`Layout PATCH failed on destination parent`, {
              destParentId,
              status: patchErr.response?.status,
              error: patchErr.response?.data?.message || patchErr.message,
            });
          }
        } else {
          log.info(`No layout fields to patch — source parent has no roomsInfo/bathrooms data`);
        }
      } catch (err) {
        log.warn(`Failed to fetch source parent for layout backfill`, { error: err.message });
      }

      // ── Diagnostic: re-read destination parent after all patches ──────────
      try {
        const current = await destClient.getListingById(destParentId);
        log.info(`Destination parent after all patches`, {
          destParentId,
          bathrooms: current?.bathrooms ?? 'MISSING',
          bedrooms: current?.bedrooms ?? 'MISSING',
          accommodates: current?.accommodates ?? 'MISSING',
          roomsInfoCount: Array.isArray(current?.roomsInfo) ? current.roomsInfo.length : 'MISSING',
        });
      } catch (err) {
        log.warn(`Failed to re-fetch destination parent for final diagnostic`, { error: err.message });
      }

    }

    log.info(`Backfill complete`, {
      complexClearOk, complexClearFail,
      complexUpdateOk, complexUpdateFail,
      availOk, availFail,
      subListingsOk,
      roomsInfoOk,
      newComplexId,
    });
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
