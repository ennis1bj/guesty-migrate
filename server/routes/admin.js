const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireAdmin } = require('../auth');
const { logger } = require('../logger');
const { decrypt } = require('../encryption');
const GuestyClient = require('../guestyClient');
const { stripFieldsDeep } = require('../migrationEngine');

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

// ── POST /api/admin/migrations/:id/source-mtl-mapping ────────────────────────
// Queries the LIVE SOURCE Guesty account to determine which dest parent each
// orphaned dest sub-unit belongs to.
//
// Strategy:
//   1. Fetch all SOURCE listings; identify MTL parents + their mtl.c child IDs
//   2. For each source MTL parent, fetch its children and read their mtl.p
//      (which was manually set post-migration to = dest parent LISTING ID)
//   3. Build mapping: srcParentMtlId → destParentListingId
//   4. Fetch all DEST listings; find orphaned MTL_CHILD sub-units
//   5. Each dest sub-unit has a wrong mtl.p = OLD source parent mtl._id
//      → look that up in the map to find the correct dest parent
//   6. Also try nickname matching as a fallback
//
// Returns: { resolved: [{ destSubUnitId, destSubUnitNick, destParentListingId,
//                          destParentTitle, matchMethod }],
//            unresolved: [...], srcParents: [...] }

router.post('/migrations/:id/source-mtl-mapping', async (req, res) => {
  try {
    const { id } = req.params;

    const migResult = await pool.query(
      `SELECT source_client_id, source_client_secret,
              dest_client_id, dest_client_secret FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Migration not found' });
    const row = migResult.rows[0];

    const srcClient = new GuestyClient({
      clientId: decrypt(row.source_client_id),
      clientSecret: decrypt(row.source_client_secret),
    });
    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // ── Step 1: fetch all SOURCE listings ──────────────────────────────────
    logger.info('source-mtl-mapping: fetching all source listings', { migrationId: id });
    const srcListings = await srcClient.getAllListings();
    logger.info('source-mtl-mapping: fetched source listings', { migrationId: id, total: srcListings.length });

    // Identify source MTL parents
    const srcParents = srcListings.filter(l => l.type === 'MTL');
    logger.info('source-mtl-mapping: source MTL parents', {
      migrationId: id,
      count: srcParents.length,
      titles: srcParents.map(p => p.nickname || p.title || p._id),
    });

    // ── Step 2: for each source parent, fetch its children ─────────────────
    // Each source parent's mtl.c contains source child listing IDs
    // Each child's mtl.p = dest parent LISTING ID (set as tracking post-migration)
    const srcParentToDestParent = {}; // srcParentMtlId → destParentListingId
    const srcChildNickToDestParent = {}; // srcChildNickname → destParentListingId
    const srcParentDetails = [];

    for (const sp of srcParents) {
      const childIds = Array.isArray(sp.mtl?.c) ? sp.mtl.c : [];
      if (childIds.length === 0) {
        logger.info('source-mtl-mapping: source parent has no children', { srcParentId: sp._id, title: sp.nickname || sp.title });
        continue;
      }

      logger.info('source-mtl-mapping: fetching children for source parent', {
        srcParentId: sp._id, title: sp.nickname || sp.title, childCount: childIds.length,
      });

      const children = await srcClient.getListingsByIds(childIds);

      // Determine which dest parent this source parent maps to
      // Children's mtl.p = dest parent listing ID (tracking)
      const destParentVotes = {};
      for (const child of children) {
        const destListingId = child.mtl?.p;
        if (destListingId) {
          destParentVotes[destListingId] = (destParentVotes[destListingId] || 0) + 1;
        }
      }

      // Pick the dest parent with the most votes (majority)
      let destParentListingId = null;
      let maxVotes = 0;
      for (const [dId, count] of Object.entries(destParentVotes)) {
        if (count > maxVotes) { maxVotes = count; destParentListingId = dId; }
      }

      const srcParentMtlId = sp.mtl?._id;
      if (srcParentMtlId && destParentListingId) {
        srcParentToDestParent[srcParentMtlId] = destParentListingId;
      }

      for (const child of children) {
        const nick = child.nickname || child.title;
        if (nick && destParentListingId) {
          srcChildNickToDestParent[nick] = destParentListingId;
        }
      }

      srcParentDetails.push({
        srcParentId: sp._id,
        srcParentMtlId,
        srcParentTitle: sp.nickname || sp.title,
        srcChildCount: children.length,
        destParentListingId,
        destParentVotes,
        children: children.map(c => ({ id: c._id, nick: c.nickname || c.title, mtlP: c.mtl?.p, mtlId: c.mtl?._id })),
      });
    }

    logger.info('source-mtl-mapping: source parent → dest parent map built', {
      migrationId: id, srcParentToDestParent,
    });

    // ── Step 3: fetch all DEST listings, find orphaned sub-units ───────────
    logger.info('source-mtl-mapping: fetching all dest listings', { migrationId: id });
    const destListings = await destClient.getAllListings();

    const destParentMap = {}; // destListingId → { mtlId, title }
    for (const l of destListings) {
      if (l.type === 'MTL' && l.mtl?._id) {
        destParentMap[l._id] = { mtlId: l.mtl._id, title: l.title || l.nickname || l._id };
      }
    }
    const validMtlIds = new Set(Object.values(destParentMap).map(p => p.mtlId));

    // Fetch dest sub-unit details (need mtl.p)
    const destSubUnitIds = destListings.filter(l => l.type === 'MTL_CHILD').map(l => l._id);
    logger.info('source-mtl-mapping: fetching dest sub-unit details', { migrationId: id, count: destSubUnitIds.length });
    const destSubUnits = await destClient.getListingsByIds(destSubUnitIds);

    // Find orphaned ones
    const orphaned = destSubUnits.filter(s => {
      const p = s.mtl?.p;
      return p && !validMtlIds.has(p);
    });
    logger.info('source-mtl-mapping: orphaned dest sub-units', { migrationId: id, count: orphaned.length });

    // ── Step 4: resolve each orphaned dest sub-unit ────────────────────────
    const resolved = [];
    const unresolved = [];

    for (const sub of orphaned) {
      const wrongMtlP = sub.mtl?.p; // = old source parent mtl._id
      const nick = sub.nickname || sub.title;

      // Method A: wrong mtl.p = old source parent mtl._id → look up dest parent
      let destParentListingId = srcParentToDestParent[wrongMtlP] || null;
      let matchMethod = destParentListingId ? 'wrong-mtlP-lookup' : null;

      // Method B: nickname match against source children
      if (!destParentListingId && nick) {
        destParentListingId = srcChildNickToDestParent[nick] || null;
        if (destParentListingId) matchMethod = 'nickname-match';
      }

      const destParentInfo = destParentListingId ? destParentMap[destParentListingId] : null;

      if (destParentListingId && destParentInfo) {
        resolved.push({
          destSubUnitId: sub._id,
          destSubUnitNick: nick,
          wrongMtlP,
          destParentListingId,
          destParentMtlId: destParentInfo.mtlId,
          destParentTitle: destParentInfo.title,
          matchMethod,
        });
      } else {
        unresolved.push({
          destSubUnitId: sub._id,
          destSubUnitNick: nick,
          wrongMtlP,
          destParentListingId: destParentListingId || null,
          note: destParentListingId && !destParentInfo
            ? 'destParentListingId found but not in dest parentMap (may be listing ID vs mtl._id mismatch)'
            : 'no match found',
        });
      }
    }

    logger.info('source-mtl-mapping: resolution complete', {
      migrationId: id, resolved: resolved.length, unresolved: unresolved.length,
    });

    res.json({
      resolved,
      unresolved,
      srcParents: srcParentDetails,
      summary: {
        srcMtlParents: srcParents.length,
        destMtlParents: Object.keys(destParentMap).length,
        orphanedDestSubUnits: orphaned.length,
        resolved: resolved.length,
        unresolved: unresolved.length,
      },
    });
  } catch (err) {
    logger.error('source-mtl-mapping error', { error: err.message, stack: err.stack });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/migrations/:id/tag-cluster-subunits ──────────────────────
// Fetches all dest listings (with tags) and groups orphaned MTL_CHILD sub-units
// by their wrong mtl.p value, showing the tag profiles of each group.
// Returns: { groups: { wrongMtlP → { count, nicknames[], tagProfile: {} } }, parents: [] }
router.post('/migrations/:id/tag-cluster-subunits', async (req, res) => {
  try {
    const { id } = req.params;
    const migResult = await pool.query(
      'SELECT dest_client_id, dest_client_secret FROM migrations WHERE id = $1',
      [id]
    );
    if (migResult.rows.length === 0) return res.status(404).json({ error: 'Migration not found' });
    const row = migResult.rows[0];

    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    const allListings = await destClient.getAllListings({ fields: '_id,type,title,nickname,mtl,tags' });
    const destParents = allListings.filter(l => l.type === 'MTL' && l.mtl?._id);
    const correctMtlIds = new Set(destParents.map(p => p.mtl._id));

    // Group orphaned sub-units by their wrong mtl.p
    const groups = {};
    const wrongSubUnits = allListings.filter(l =>
      l.type === 'MTL_CHILD' && l.mtl?.p && !correctMtlIds.has(l.mtl.p)
    );
    for (const su of wrongSubUnits) {
      const key = su.mtl.p;
      if (!groups[key]) groups[key] = { count: 0, nicknames: [], tagFreq: {} };
      const g = groups[key];
      g.count++;
      g.nicknames.push(su.nickname || su.title || su._id);
      for (const tag of (su.tags || [])) {
        g.tagFreq[tag] = (g.tagFreq[tag] || 0) + 1;
      }
    }

    // Parent info
    const parents = destParents.map(p => ({
      id: p._id,
      mtlId: p.mtl._id,
      title: p.title || p.nickname,
      expectedCount: (p.mtl.c || []).length,
      tags: p.tags || [],
    }));

    res.json({ groups, parents, wrongTotal: wrongSubUnits.length });
  } catch (err) {
    logger.error('tag-cluster-subunits error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/migrations/:id/test-mtl-patch ────────────────────────────
// ── POST /api/admin/migrations/:id/match-mtl-children ────────────────────────
// Probe: for each dest MTL parent, try querying the DEST Guesty API for its sub-units
// using the filters[parentId] query and the dedicated /sub-units endpoint.
// Returns: { parentId → { found: [{ id, title, type }] } }
router.post('/migrations/:id/probe-dest-subunits', async (req, res) => {
  try {
    const { id } = req.params;
    const migResult = await pool.query(
      'SELECT source_client_id, source_client_secret, dest_client_id, dest_client_secret FROM migrations WHERE id = $1',
      [id]
    );
    if (migResult.rows.length === 0) return res.status(404).json({ error: 'Migration not found' });
    const row = migResult.rows[0];

    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    const allDestListings = await destClient.getAllListings({ fields: '_id,type,title,nickname,mtl' });
    const destParentListings = allDestListings.filter(l => l.type === 'MTL' && l.mtl?._id);
    const allMtlIds = new Set(destParentListings.map(p => p.mtl._id));

    const result = {};
    for (const parent of destParentListings) {
      const isFixed = allDestListings.some(l => l.type === 'MTL_CHILD' && l.mtl?.p === parent.mtl._id);
      try {
        const subUnits = await destClient.getSubUnitsByListingId(parent._id);
        result[parent._id] = {
          parentTitle: parent.title || parent.nickname,
          parentMtlId: parent.mtl._id,
          isFixed,
          found: subUnits.map(s => ({ id: s._id, title: s.title || s.nickname, mtlP: s.mtl?.p })),
        };
      } catch (err) {
        result[parent._id] = {
          parentTitle: parent.title || parent.nickname,
          parentMtlId: parent.mtl._id,
          isFixed,
          error: err.message,
          found: [],
        };
      }
    }

    res.json({ result });
  } catch (err) {
    logger.error('probe-dest-subunits error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// For each dest MTL parent, fetches the source sub-units (via source Guesty API)
// using the source sub-unit IDs stored in dest parent's mtl.c, then matches
// those source sub-units to dest sub-units by title.
// Returns: { parentId → { parentTitle, expectedCount, sourceChildTitles: [{ sourceId, title }] } }
router.post('/migrations/:id/match-mtl-children', async (req, res) => {
  try {
    const { id } = req.params;
    const migResult = await pool.query(
      `SELECT source_client_id, source_client_secret, dest_client_id, dest_client_secret FROM migrations WHERE id = $1`, [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const row = migResult.rows[0];
    const sourceClient = new GuestyClient({
      clientId: decrypt(row.source_client_id),
      clientSecret: decrypt(row.source_client_secret),
    });
    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // Get all dest listings
    const allDestListings = await destClient.getAllListings({ fields: '_id,type,title,nickname,mtl' });
    const destParentListings = allDestListings.filter(l => l.type === 'MTL' && l.mtl?._id);

    // Strategy: fetch each source sub-unit from the source account and read its
    // mtl._id. The old migration engine (running at time of this migration) did NOT
    // strip the 'mtl' field, so it copied source sub-unit mtl.p directly into the
    // dest sub-unit. For these listings, source sub-unit mtl.p = source sub-unit mtl._id
    // (a self-referential MTL entity ID). Therefore:
    //   dest sub-unit wrong mtl.p == source sub-unit mtl._id
    // This lets us build: sourceMtlId → destParentId, then match each orphaned dest
    // sub-unit (by its wrong mtl.p) to the correct dest parent.

    // Step 1: Identify "already fixed" parents.
    const allMtlIds = new Set(destParentListings.map(p => p.mtl._id));
    const fixedParentMtlIds = new Set();
    for (const l of allDestListings) {
      if (l.type === 'MTL_CHILD' && allMtlIds.has(l.mtl?.p)) {
        fixedParentMtlIds.add(l.mtl.p);
      }
    }

    // Step 2: For each unfixed dest parent, fetch source sub-units and map their
    //         mtl._id → destParentId.
    const sourceMtlIdToParent = {}; // sourceMtlId → { destParentId, destParentMtlId, parentTitle }
    const result = {};
    for (const parent of destParentListings) {
      if (fixedParentMtlIds.has(parent.mtl._id)) {
        result[parent._id] = {
          parentTitle: parent.title || parent.nickname,
          parentMtlId: parent.mtl._id,
          status: 'already-fixed',
          expectedCount: Array.isArray(parent.mtl?.c) ? parent.mtl.c.length : 0,
        };
        continue;
      }
      const sourceChildIds = Array.isArray(parent.mtl?.c) ? parent.mtl.c : [];
      if (sourceChildIds.length === 0) {
        result[parent._id] = { parentTitle: parent.title, parentMtlId: parent.mtl._id, status: 'no-source-children' };
        continue;
      }

      // Fetch source sub-units individually to get their mtl._id
      const sourceChildren = await sourceClient.getListingsByIds(sourceChildIds);
      const mappings = [];
      for (const sc of sourceChildren) {
        const srcMtlId = sc.mtl?._id ?? null;
        if (srcMtlId) {
          sourceMtlIdToParent[srcMtlId] = {
            destParentId: parent._id,
            destParentMtlId: parent.mtl._id,
            parentTitle: parent.title || parent.nickname,
          };
        }
        mappings.push({
          sourceListingId: sc._id,
          sourceNickname: sc.nickname || null,
          sourceTitle: sc.title || null,
          sourceMtlId: srcMtlId,
          sourceMtlP: sc.mtl?.p ?? null,
        });
      }

      result[parent._id] = {
        parentTitle: parent.title || parent.nickname,
        parentMtlId: parent.mtl._id,
        status: 'pending',
        expectedCount: sourceChildIds.length,
        fetchedFromSource: sourceChildren.length,
        mtlIdsMapped: mappings.filter(m => m.sourceMtlId).length,
        mappings,
      };
    }

    // Step 3: Match each orphaned dest sub-unit to its parent using wrong mtl.p == sourceMtlId
    const wrongDestSubUnits = allDestListings
      .filter(l => l.type === 'MTL_CHILD' && !allMtlIds.has(l.mtl?.p));

    const matched = [];
    const unmatched = [];
    for (const sub of wrongDestSubUnits) {
      const wrongMtlP = sub.mtl?.p;
      const parentInfo = wrongMtlP ? sourceMtlIdToParent[wrongMtlP] : null;
      if (parentInfo) {
        matched.push({
          destSubId: sub._id,
          destTitle: sub.title || sub.nickname,
          wrongMtlP,
          ...parentInfo,
        });
      } else {
        unmatched.push({
          destSubId: sub._id,
          destTitle: sub.title || sub.nickname,
          wrongMtlP,
        });
      }
    }

    // Group matched by parent
    for (const m of matched) {
      if (result[m.destParentId]) {
        result[m.destParentId].matchedSubUnits = result[m.destParentId].matchedSubUnits || [];
        result[m.destParentId].matchedSubUnits.push({ destSubId: m.destSubId, destTitle: m.destTitle, wrongMtlP: m.wrongMtlP });
        result[m.destParentId].matchedCount = (result[m.destParentId].matchedCount || 0) + 1;
      }
    }

    res.json({
      sourceMtlIdsMapped: Object.keys(sourceMtlIdToParent).length,
      wrongDestSubUnitsTotal: wrongDestSubUnits.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      result,
      unmatched,
      sourceMtlIdToParent,
    });
  } catch (err) {
    logger.error('match-mtl-children error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Quick probe: fetch a single dest listing and return its full structure.
// Used to inspect subListingsIds, mtl, etc. on any listing.
// Body: { listingId }
router.post('/migrations/:id/get-dest-listing', async (req, res) => {
  try {
    const { id } = req.params;
    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ error: 'listingId required' });
    const migResult = await pool.query(
      `SELECT dest_client_id, dest_client_secret FROM migrations WHERE id = $1`, [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const row = migResult.rows[0];
    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });
    const listing = await destClient.getListingById(listingId);
    res.json({ listing });
  } catch (err) {
    logger.error('get-dest-listing error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// One-shot test: tries to SET mtl.p on a single sub-unit using the parent's
// mtl._id (not listing _id) and then reads it back to confirm persistence.
// Body: { destSubUnitId, destParentMtlId }
router.post('/migrations/:id/test-mtl-patch', async (req, res) => {
  try {
    const { id } = req.params;
    const { destSubUnitId, destParentMtlId } = req.body;
    if (!destSubUnitId || !destParentMtlId) {
      return res.status(400).json({ error: 'destSubUnitId and destParentMtlId are required' });
    }
    const migResult = await pool.query(
      `SELECT dest_client_id, dest_client_secret FROM migrations WHERE id = $1`, [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const row = migResult.rows[0];
    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    const before = await destClient.getListingById(destSubUnitId);
    const beforeMtl = before?.mtl;

    // Attempt 1: set mtl.p to parent's mtl._id
    try {
      await destClient.updateListing(destSubUnitId, {
        mtl: { ...beforeMtl, p: destParentMtlId, c: [] },
      });
    } catch (err) {
      logger.warn('test-mtl-patch PUT failed', { error: err.message });
    }

    const afterMtl = (await destClient.getListingById(destSubUnitId))?.mtl;

    // Attempt 2: try setting parentId directly
    let afterParentIdMtl = null;
    try {
      await destClient.updateListing(destSubUnitId, { parentId: destParentMtlId });
      afterParentIdMtl = (await destClient.getListingById(destSubUnitId))?.mtl;
    } catch (err) {
      logger.warn('test-mtl-patch parentId PUT failed', { error: err.message });
    }

    res.json({
      destSubUnitId,
      destParentMtlId,
      beforeMtlP: beforeMtl?.p,
      afterMtlPatchMtlP: afterMtl?.p,
      mtlPatchWorked: afterMtl?.p === destParentMtlId,
      afterParentIdPatchMtlP: afterParentIdMtl?.p,
      parentIdPatchWorked: afterParentIdMtl?.p === destParentMtlId,
    });
  } catch (err) {
    logger.error('test-mtl-patch error', { error: err.message });
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

    // Step 2: for each dest parent query its sub-units via parentId filter
    // (primary strategy — no source access needed).
    // We sent parentId=destParentId when creating each sub-unit; Guesty stores this
    // internally even though it is not returned in GET /listings/:id responses.
    log.info(`Querying dest account for sub-units of each of ${parents.length} parent(s)`);
    const subUnitParentMap = new Map(); // destSubId → destParentId
    const destSubUnitIds = new Set(subUnits.map(s => s.destId));

    await Promise.allSettled(
      parents.map(async parent => {
        try {
          const children = await destClient.getSubUnitsByListingId(parent.destId);
          let matched = 0;
          for (const child of children) {
            const childId = child._id;
            // Only map sub-units that are actually in our idMap (this migration)
            if (childId && destSubUnitIds.has(childId)) {
              subUnitParentMap.set(childId, parent.destId);
              matched++;
            }
          }
          log.info(`Parent ${parent.destId}: found ${children.length} sub-unit(s) in dest, matched ${matched} to idMap`);
        } catch (err) {
          log.warn(`getSubUnitsByListingId failed for parent ${parent.destId}`, { error: err.message });
        }
      })
    );

    // Fallback: if dest query found nothing and source client is available, try source
    const unresolved = subUnits.filter(s => !subUnitParentMap.has(s.destId));
    if (unresolved.length > 0 && sourceClient) {
      log.info(`${unresolved.length} sub-units unresolved from dest query — trying source account`);
      await Promise.allSettled(
        unresolved.map(async sub => {
          if (!sub.srcId) return;
          try {
            const srcListing = await sourceClient.getListingById(sub.srcId);
            const srcParentId = srcListing?.parentId;
            if (!srcParentId) return;
            const destParentId = idMap[srcParentId];
            if (destParentId) subUnitParentMap.set(sub.destId, destParentId);
          } catch (err) {
            log.warn(`Source fetch failed for sub-unit`, { srcId: sub.srcId, error: err.message });
          }
        })
      );
    }

    // Last-resort: if still unresolved and only one parent, assign all to it
    const stillUnresolved = subUnits.filter(s => !subUnitParentMap.has(s.destId));
    if (stillUnresolved.length > 0 && parents.length === 1) {
      for (const sub of stillUnresolved) subUnitParentMap.set(sub.destId, parents[0].destId);
      log.info(`Assigned ${stillUnresolved.length} unresolved sub-unit(s) to sole parent`);
    }

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

// ── POST /api/admin/migrations/:id/recreate-sub-units ────────────────────────
// Deletes and re-creates destination sub-unit listings whose mtl.p value
// matches `targetMtlP` so that Guesty auto-populates the mtl relationship
// from scratch using the provided `destParentId`.
//
// This is the only reliable fix when mtl.p is wrong on destination sub-units
// (the Open API silently ignores PUT /listings/:id with { mtl: ... }).
//
// Body: {
//   targetMtlP: string,    // current wrong mtl.p value that identifies the group
//   destParentId: string,  // correct dest parent listing ID to link them to
//   dryRun?: boolean       // if true, report matches without deleting/recreating
// }
//
// Runs async; returns 202 with initial count.  Progress visible in server logs.
router.post('/migrations/:id/recreate-sub-units', async (req, res) => {
  const ADDITIONAL_STRIP = new Set([
    '__v', 'lastUpdatedAt', 'lastActivityAt', 'cleaningStatus',
    'pendingTasks', 'occupancyStats', 'SaaS', 'sourceOfCreation', 'pms',
    'activeReservationCount', 'sales', 'commissionFormula',
    'netIncomeFormula', 'ownerRevenueFormula',
  ]);

  function cleanForRecreate(listing) {
    const stripped = stripFieldsDeep(listing); // removes SOURCE_ONLY_FIELDS incl. mtl
    const cleaned = {};
    for (const [k, v] of Object.entries(stripped)) {
      if (!ADDITIONAL_STRIP.has(k)) cleaned[k] = v;
    }
    return cleaned;
  }

  try {
    const { id } = req.params;
    // subUnitIds: explicit list of dest IDs to process (skips mtl.p scan)
    // targetMtlP: scan all listings and match by mtl.p (ignored when subUnitIds given)
    // destParentId: listing _id of the destination parent
    // destParentMtlId: parent's mtl._id — if given, set mtl.p on recreated sub-units
    const { targetMtlP, destParentId, destParentMtlId, subUnitIds, dryRun = false } = req.body;
    if (!destParentId) {
      return res.status(400).json({ error: 'destParentId is required' });
    }
    if (!subUnitIds && !targetMtlP) {
      return res.status(400).json({ error: 'Either subUnitIds (array) or targetMtlP is required' });
    }

    const migResult = await pool.query(
      `SELECT dest_client_id, dest_client_secret, results FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const row = migResult.rows[0];
    const idMap = { ...(row.results?.listings?.idMap || {}) };
    const allDestIds = Object.values(idMap);

    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    res.status(202).json({ message: 'recreate-sub-units started', totalListings: allDestIds.length, dryRun });

    let matches;
    if (Array.isArray(subUnitIds) && subUnitIds.length > 0) {
      matches = subUnitIds;
      logger.info('recreate-sub-units: using explicit subUnitIds', { migrationId: id, count: matches.length, dryRun });
    } else {
      // Step 1: fetch mtl.p for each listing in parallel (semaphored inside GuestyClient)
      logger.info('recreate-sub-units: scanning all dest listings for mtl.p', { migrationId: id, count: allDestIds.length });
      const mtlPResults = await Promise.allSettled(
        allDestIds.map(async destId => {
          const l = await destClient.getListingById(destId);
          return { destId, mtlP: l?.mtl?.p ?? null, type: l?.type };
        })
      );

      // Step 2: identify matches
      matches = mtlPResults
        .filter(r => r.status === 'fulfilled' && r.value.mtlP === targetMtlP)
        .map(r => r.value.destId);

      logger.info('recreate-sub-units: identified matching sub-units', { migrationId: id, targetMtlP, count: matches.length, dryRun });
    }

    if (dryRun) {
      logger.info('recreate-sub-units: dry-run complete', { migrationId: id, matches });
      return;
    }

    // Step 3: for each match, fetch full data → delete → recreate
    const reversedIdMap = Object.fromEntries(Object.entries(idMap).map(([s, d]) => [d, s]));
    const idMapUpdates = {}; // srcId → newDestId

    let ok = 0; let failed = 0;
    for (const oldDestId of matches) {
      try {
        const fullListing = await destClient.getListingById(oldDestId);
        if (!fullListing) throw new Error('Could not fetch listing ' + oldDestId);

        const payload = cleanForRecreate(fullListing);
        payload.parentId = destParentId;
        // Ensure correct type
        payload.type = 'MTL_CHILD';
        // Explicitly set mtl.p to the parent's mtl._id so Guesty wires it correctly.
        // mtl is stripped by cleanForRecreate (SOURCE_ONLY_FIELDS); add it back here.
        if (destParentMtlId) {
          payload.mtl = { p: destParentMtlId };
        }

        // Delete old sub-unit
        await destClient.request('DELETE', `/listings/${oldDestId}`);
        logger.info('recreate-sub-units: deleted old sub-unit', { migrationId: id, oldDestId });

        // Recreate
        const created = await destClient.request('POST', '/listings', payload);
        const newDestId = created?._id;
        if (!newDestId) throw new Error('No _id returned from POST /listings for ' + oldDestId);

        logger.info('recreate-sub-units: recreated sub-unit', { migrationId: id, oldDestId, newDestId });

        // Track idMap update
        const srcId = reversedIdMap[oldDestId];
        if (srcId) idMapUpdates[srcId] = newDestId;

        ok++;
      } catch (err) {
        logger.error('recreate-sub-units: failed for sub-unit', { migrationId: id, oldDestId, error: err.message });
        failed++;
      }
    }

    // Step 4: persist idMap updates
    if (Object.keys(idMapUpdates).length > 0) {
      const current = await pool.query(`SELECT results FROM migrations WHERE id = $1`, [id]);
      const results = current.rows[0]?.results || {};
      const newIdMap = { ...(results.listings?.idMap || {}), ...idMapUpdates };
      const updatedResults = { ...results, listings: { ...results.listings, idMap: newIdMap } };
      await pool.query(`UPDATE migrations SET results = $1 WHERE id = $2`, [JSON.stringify(updatedResults), id]);
      logger.info('recreate-sub-units: idMap updated', { migrationId: id, updated: Object.keys(idMapUpdates).length });
    }

    logger.info('recreate-sub-units: complete', { migrationId: id, ok, failed, idMapUpdated: Object.keys(idMapUpdates).length });
  } catch (err) {
    logger.error('recreate-sub-units error', { error: err.message });
  }
});

// ── POST /api/admin/migrations/:id/scan-and-fix-all-mtl ──────────────────────
// Scans ALL destination listings for this migration to identify sub-units with
// incorrect mtl.p values and re-creates them with the correct parent reference.
// Works without an idMap — discovers parent-child groupings via each sub-unit's
// parentId field (remapped to the dest parent listing _id at creation time).
//
// Body:
//   dryRun (bool, default false) — report only, no changes
//
// Response: 202 with a { report } object (async fix logged to server).
router.post('/migrations/:id/scan-and-fix-all-mtl', async (req, res) => {
  const ADDITIONAL_STRIP = new Set([
    '__v', 'lastUpdatedAt', 'lastActivityAt', 'cleaningStatus',
    'pendingTasks', 'occupancyStats', 'SaaS', 'sourceOfCreation', 'pms',
    'activeReservationCount', 'sales', 'commissionFormula',
    'netIncomeFormula', 'ownerRevenueFormula',
  ]);

  function cleanForRecreate(listing) {
    const stripped = stripFieldsDeep(listing);
    const cleaned = {};
    for (const [k, v] of Object.entries(stripped)) {
      if (!ADDITIONAL_STRIP.has(k)) cleaned[k] = v;
    }
    return cleaned;
  }

  try {
    const { id } = req.params;
    const { dryRun = false } = req.body;

    const migResult = await pool.query(
      `SELECT dest_client_id, dest_client_secret, results FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const row = migResult.rows[0];

    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // Step 1: fetch all listings from the destination account
    logger.info('scan-and-fix-all-mtl: fetching all destination listings', { migrationId: id });
    const allListings = await destClient.getAllListings();
    logger.info('scan-and-fix-all-mtl: fetched listings', { migrationId: id, total: allListings.length });

    // Step 2: build parent map  destListingId → { mtlId, title }
    const parentMap = {};
    for (const l of allListings) {
      if (l.type === 'MTL' && l.mtl?._id) {
        parentMap[l._id] = { mtlId: l.mtl._id, title: l.title || l.nickname || l._id };
      }
    }

    // Step 3: individually fetch all dest sub-units using their DEST IDs (from
    // bulk listing), read their mtl.p value, and group by mtl.p.
    //
    // Strategy rationale:
    //   • parentId is not returned by Guesty GET /listings (bulk or individual)
    //   • mtl.c on parents contains source-world IDs (not dest IDs) → 403 on fetch
    //   • complexId API returns 0 for this account tier
    //   • mtl.p on sub-units IS returned even for individual fetches
    //   → Group sub-units by their current (wrong) mtl.p; match each group to
    //     the correct dest parent by count (each parent has a unique sub-unit count).
    const destSubUnitIds = allListings.filter(l => l.type === 'MTL_CHILD').map(l => l._id);
    logger.info('scan-and-fix-all-mtl: individually fetching dest sub-units for mtl.p', {
      migrationId: id, count: destSubUnitIds.length,
    });
    const subUnitDetails = await destClient.getListingsByIds(destSubUnitIds);
    logger.info('scan-and-fix-all-mtl: fetched sub-unit details', { migrationId: id, fetched: subUnitDetails.length });

    // Build set of valid dest parent mtlIds for the "already correct" check
    const validMtlIds = new Set(Object.values(parentMap).map(p => p.mtlId));

    // Group sub-units by their current mtl.p value
    // wrongMtlPGroups: mtlPValue → [{ _id, title }]
    const wrongMtlPGroups = {};
    let alreadyCorrect = 0;
    for (const sub of subUnitDetails) {
      const currentMtlP = sub.mtl?.p ?? null;
      if (currentMtlP && validMtlIds.has(currentMtlP)) {
        alreadyCorrect++;
      } else {
        const key = currentMtlP || '__null__';
        if (!wrongMtlPGroups[key]) wrongMtlPGroups[key] = [];
        wrongMtlPGroups[key].push({ _id: sub._id, title: sub.title || sub.nickname });
      }
    }

    logger.info('scan-and-fix-all-mtl: wrong-mtlP groups found', {
      migrationId: id, alreadyCorrect,
      groups: Object.entries(wrongMtlPGroups).map(([k, v]) => ({ mtlP: k, count: v.length })),
    });

    // Match each wrong group to a dest parent using COUNT.
    // Each parent has a unique expected sub-unit count derived from mtl.c length
    // (source-world count) — even if mtl.c contains wrong IDs, the count is accurate.
    const parentListings = allListings.filter(l => l.type === 'MTL' && parentMap[l._id]);
    const parentCountMap = {}; // expectedCount → destParentId (only unambiguous matches)
    const countToParents = {};
    for (const p of parentListings) {
      const count = Array.isArray(p.mtl?.c) ? p.mtl.c.length : 0;
      if (!countToParents[count]) countToParents[count] = [];
      countToParents[count].push(p._id);
    }
    for (const [count, ids] of Object.entries(countToParents)) {
      if (ids.length === 1) parentCountMap[Number(count)] = ids[0];
    }

    const groups = {}; // destParentListingId → { parent, wrongSubUnits }
    const orphaned = []; // groups that couldn't be matched

    for (const [wrongMtlP, subUnits] of Object.entries(wrongMtlPGroups)) {
      const count = subUnits.length;
      const destParentId = parentCountMap[count];
      if (!destParentId) {
        logger.warn('scan-and-fix-all-mtl: could not match group to parent by count', {
          migrationId: id, wrongMtlP, count,
        });
        orphaned.push({ wrongMtlP, count, subUnitIds: subUnits.map(s => s._id), sampleTitles: subUnits.slice(0, 3).map(s => s.title) });
        continue;
      }
      const parentInfo = parentMap[destParentId];
      groups[destParentId] = {
        parent: { ...parentInfo, destParentId },
        wrongMtlP,
        wrongSubUnits: subUnits,
      };
      logger.info('scan-and-fix-all-mtl: matched group to parent', {
        migrationId: id, wrongMtlP, count, destParentId, parentTitle: parentInfo.title,
      });
    }

    const report = {
      totalListings: allListings.length,
      mtlParents: Object.keys(parentMap).length,
      alreadyCorrect,
      orphanedCount: orphaned.reduce((s, o) => s + o.count, 0),
      orphaned,
      groupsNeedingFix: Object.keys(groups).length,
      groups: Object.entries(groups).map(([destParentId, g]) => ({
        destParentId,
        parentTitle: g.parent.title,
        destParentMtlId: g.parent.mtlId,
        subUnitsToFix: g.wrongSubUnits.length,
        subUnitIds: g.wrongSubUnits.map(s => s._id),
        sampleTitles: g.wrongSubUnits.slice(0, 5).map(s => s.title),
        currentMtlPValue: g.wrongMtlP,
      })),
    };

    res.status(202).json({ message: 'scan-and-fix-all-mtl started', dryRun, report });

    if (dryRun) {
      logger.info('scan-and-fix-all-mtl: dry-run complete', { migrationId: id, report });
      return;
    }

    // Step 4: for each group, recreate the bad sub-units with correct mtl.p
    const idMap = { ...(row.results?.listings?.idMap || {}) };
    const reversedIdMap = Object.fromEntries(Object.entries(idMap).map(([s, d]) => [d, s]));
    const idMapUpdates = {};

    for (const [destParentId, g] of Object.entries(groups)) {
      const { mtlId: destParentMtlId, title: parentTitle } = g.parent;
      logger.info('scan-and-fix-all-mtl: fixing parent group', {
        migrationId: id, destParentId, destParentMtlId, parentTitle, count: g.wrongSubUnits.length,
      });

      let ok = 0; let failed = 0;
      for (const { _id: oldDestId } of g.wrongSubUnits) {
        try {
          const fullListing = await destClient.getListingById(oldDestId);
          if (!fullListing) throw new Error('Could not fetch listing ' + oldDestId);

          const payload = cleanForRecreate(fullListing);
          payload.parentId = destParentId;
          payload.type = 'MTL_CHILD';
          payload.mtl = { p: destParentMtlId };

          await destClient.request('DELETE', `/listings/${oldDestId}`);
          logger.info('scan-and-fix-all-mtl: deleted', { migrationId: id, oldDestId });

          const created = await destClient.request('POST', '/listings', payload);
          const newDestId = created?._id;
          if (!newDestId) throw new Error('No _id returned from POST for ' + oldDestId);

          logger.info('scan-and-fix-all-mtl: recreated', { migrationId: id, oldDestId, newDestId, destParentMtlId });

          const srcId = reversedIdMap[oldDestId];
          if (srcId) idMapUpdates[srcId] = newDestId;
          ok++;
        } catch (err) {
          logger.error('scan-and-fix-all-mtl: failed for sub-unit', { migrationId: id, oldDestId, error: err.message });
          failed++;
        }
      }
      logger.info('scan-and-fix-all-mtl: group complete', { migrationId: id, parentTitle, ok, failed });
    }

    // Step 5: persist any idMap updates (best-effort)
    if (Object.keys(idMapUpdates).length > 0) {
      const current = await pool.query(`SELECT results FROM migrations WHERE id = $1`, [id]);
      const results = current.rows[0]?.results || {};
      const newIdMap = { ...(results.listings?.idMap || {}), ...idMapUpdates };
      const updatedResults = { ...results, listings: { ...results.listings, idMap: newIdMap } };
      await pool.query(`UPDATE migrations SET results = $1 WHERE id = $2`, [JSON.stringify(updatedResults), id]);
      logger.info('scan-and-fix-all-mtl: idMap updated', { migrationId: id, updated: Object.keys(idMapUpdates).length });
    }

    logger.info('scan-and-fix-all-mtl: all groups complete', { migrationId: id, totalIdMapUpdates: Object.keys(idMapUpdates).length });
  } catch (err) {
    logger.error('scan-and-fix-all-mtl error', { error: err.message });
  }
});

// ── POST /api/admin/migrations/:id/manual-assign-mtl-subunits ────────────────
// Manually re-parent orphaned MTL_CHILD sub-units whose correct parent cannot
// be determined automatically.
//
// Body: {
//   assignments: [
//     { destSubUnitId: "<dest listing id>", destParentListingId: "<dest parent listing id>" },
//     ...
//   ],
//   dryRun: false   // optional; default false
// }
//
// For each assignment the endpoint will:
//   1. Fetch the current dest sub-unit's full data
//   2. Verify the given destParentListingId is an MTL parent in the dest account
//   3. (if not dryRun) Delete the old sub-unit and recreate it with correct parentId + mtl.p
//
// Returns: { ok, failed, skipped, results: [...] }

router.post('/migrations/:id/manual-assign-mtl-subunits', async (req, res) => {
  try {
    const { id } = req.params;
    const { assignments = [], dryRun = false } = req.body;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ error: 'assignments must be a non-empty array' });
    }

    const migResult = await pool.query(
      `SELECT dest_client_id, dest_client_secret, results FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Migration not found' });
    const row = migResult.rows[0];

    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // Fetch all dest listings to build parent map (listingId → mtlId)
    logger.info('manual-assign-mtl-subunits: fetching all destination listings', { migrationId: id });
    const allListings = await destClient.getAllListings();
    const parentMap = {};
    for (const l of allListings) {
      if (l.type === 'MTL' && l.mtl?._id) {
        parentMap[l._id] = { mtlId: l.mtl._id, title: l.title || l.nickname || l._id };
      }
    }
    logger.info('manual-assign-mtl-subunits: dest parents found', { migrationId: id, count: Object.keys(parentMap).length });

    res.status(202).json({ message: 'manual-assign-mtl-subunits started', dryRun, total: assignments.length });

    const idMap = { ...(row.results?.listings?.idMap || {}) };
    const reversedIdMap = Object.fromEntries(Object.entries(idMap).map(([s, d]) => [d, s]));
    const idMapUpdates = {};

    const results = [];
    let ok = 0; let failed = 0; let skipped = 0;

    for (const { destSubUnitId, destParentListingId } of assignments) {
      const parentInfo = parentMap[destParentListingId];
      if (!parentInfo) {
        logger.warn('manual-assign-mtl-subunits: unknown parent listing id', { migrationId: id, destParentListingId, destSubUnitId });
        results.push({ destSubUnitId, destParentListingId, status: 'skipped', reason: 'parent not found in dest account' });
        skipped++;
        continue;
      }
      const { mtlId: destParentMtlId, title: parentTitle } = parentInfo;

      if (dryRun) {
        logger.info('manual-assign-mtl-subunits: dry-run assignment', { migrationId: id, destSubUnitId, destParentListingId, destParentMtlId, parentTitle });
        results.push({ destSubUnitId, destParentListingId, destParentMtlId, parentTitle, status: 'dry-run' });
        skipped++;
        continue;
      }

      try {
        const fullListing = await destClient.getListingById(destSubUnitId);
        if (!fullListing) throw new Error('Could not fetch listing ' + destSubUnitId);

        const READ_ONLY_FIELDS = new Set([
          '_id', 'id', 'accountId', 'createdAt', 'updatedAt', 'lastActivityAt',
          'importedAt', 'integrations', 'isListed', 'listed', 'listingRooms',
          'calendarRules', 'customFields', 'amenitiesNotIncluded',
          'activeReservationCount', 'sales', 'commissionFormula',
          'netIncomeFormula', 'ownerRevenueFormula',
        ]);

        function stripIds(obj) {
          if (Array.isArray(obj)) return obj.map(stripIds);
          if (obj && typeof obj === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
              if (k === '_id' || k === 'id') continue;
              out[k] = stripIds(v);
            }
            return out;
          }
          return obj;
        }

        const payload = {};
        for (const [k, v] of Object.entries(fullListing)) {
          if (!READ_ONLY_FIELDS.has(k)) payload[k] = stripIds(v);
        }
        payload.parentId = destParentListingId;
        payload.type = 'MTL_CHILD';
        payload.mtl = { p: destParentMtlId };

        await destClient.request('DELETE', `/listings/${destSubUnitId}`);
        logger.info('manual-assign-mtl-subunits: deleted old sub-unit', { migrationId: id, destSubUnitId, destParentListingId, destParentMtlId });

        const created = await destClient.request('POST', '/listings', payload);
        const newDestId = created?._id;
        if (!newDestId) throw new Error('No _id returned from POST for ' + destSubUnitId);

        logger.info('manual-assign-mtl-subunits: recreated sub-unit', { migrationId: id, oldId: destSubUnitId, newId: newDestId, destParentMtlId, parentTitle });

        const srcId = reversedIdMap[destSubUnitId];
        if (srcId) idMapUpdates[srcId] = newDestId;

        results.push({ destSubUnitId, newDestId, destParentListingId, destParentMtlId, parentTitle, status: 'ok' });
        ok++;
      } catch (err) {
        logger.error('manual-assign-mtl-subunits: failed', { migrationId: id, destSubUnitId, error: err.message });
        results.push({ destSubUnitId, destParentListingId, status: 'failed', error: err.message });
        failed++;
      }
    }

    if (Object.keys(idMapUpdates).length > 0) {
      const current = await pool.query(`SELECT results FROM migrations WHERE id = $1`, [id]);
      const existingResults = current.rows[0]?.results || {};
      const newIdMap = { ...(existingResults.listings?.idMap || {}), ...idMapUpdates };
      const updatedResults = { ...existingResults, listings: { ...existingResults.listings, idMap: newIdMap } };
      await pool.query(`UPDATE migrations SET results = $1 WHERE id = $2`, [JSON.stringify(updatedResults), id]);
      logger.info('manual-assign-mtl-subunits: idMap updated', { migrationId: id, updated: Object.keys(idMapUpdates).length });
    }

    logger.info('manual-assign-mtl-subunits: complete', { migrationId: id, ok, failed, skipped, total: assignments.length });
  } catch (err) {
    logger.error('manual-assign-mtl-subunits error', { error: err.message, stack: err.stack });
  }
});

// ── POST /api/admin/migrations/:id/recreate-missing-mtl-parents ──────────────
// Identifies orphaned MTL_CHILD sub-units whose mtl.p points to a source
// standalone parent that was never created in the destination account.
// For each missing dest parent it:
//   1. Fetches the source parent listing data
//   2. Creates a matching dest MTL parent (same nickname, address, etc.)
//   3. Re-parents all orphaned sub-units in that group to the new dest parent
//
// This is the automated equivalent of "recreate the source MTL structure in
// the destination" — no manual mapping needed.
//
// Body: { dryRun: false }
// Response: 202 with a { report } object (async fix logged to server).

router.post('/migrations/:id/recreate-missing-mtl-parents', async (req, res) => {
  const ADDITIONAL_STRIP = new Set([
    '__v', 'lastUpdatedAt', 'lastActivityAt', 'cleaningStatus',
    'pendingTasks', 'occupancyStats', 'SaaS', 'sourceOfCreation', 'pms',
    'activeReservationCount', 'sales', 'commissionFormula',
    'netIncomeFormula', 'ownerRevenueFormula',
    // yieldManagement contains nested _id fields that stripFieldsDeep removes,
    // causing Guesty validation to fail ("_id is required"). Let Guesty create
    // it fresh with defaults instead.
    'yieldManagement',
  ]);

  function cleanForRecreate(listing) {
    const stripped = stripFieldsDeep(listing);
    const cleaned = {};
    for (const [k, v] of Object.entries(stripped)) {
      if (!ADDITIONAL_STRIP.has(k)) cleaned[k] = v;
    }
    return cleaned;
  }

  try {
    const { id } = req.params;
    const { dryRun = false } = req.body;

    const migResult = await pool.query(
      `SELECT source_client_id, source_client_secret,
              dest_client_id, dest_client_secret, results
       FROM migrations WHERE id = $1`,
      [id]
    );
    if (migResult.rowCount === 0) return res.status(404).json({ error: 'Migration not found' });
    const row = migResult.rows[0];

    const sourceClient = new GuestyClient({
      clientId: decrypt(row.source_client_id),
      clientSecret: decrypt(row.source_client_secret),
    });
    const destClient = new GuestyClient({
      clientId: decrypt(row.dest_client_id),
      clientSecret: decrypt(row.dest_client_secret),
    });

    // Step 1: fetch all dest listings and build parent map + sub-unit list
    logger.info('recreate-missing-mtl-parents: fetching all dest listings', { migrationId: id });
    const allDestListings = await destClient.getAllListings();
    const destParentMap = {};
    const destNickToParentId = {};
    for (const l of allDestListings) {
      if (l.type === 'MTL' && l.mtl?._id) {
        destParentMap[l._id] = { mtlId: l.mtl._id, title: l.title || l.nickname || l._id };
        if (l.nickname) destNickToParentId[l.nickname] = l._id;
      }
    }
    const validMtlIds = new Set(Object.values(destParentMap).map(p => p.mtlId));

    // Step 2: individually fetch all dest sub-units to read their mtl.p
    const destSubUnitIds = allDestListings.filter(l => l.type === 'MTL_CHILD').map(l => l._id);
    logger.info('recreate-missing-mtl-parents: fetching dest sub-unit details', { migrationId: id, count: destSubUnitIds.length });
    const subUnitDetails = await destClient.getListingsByIds(destSubUnitIds);

    // Step 3: identify orphaned sub-units (mtl.p not in validMtlIds)
    const wrongGroups = {};
    for (const sub of subUnitDetails) {
      const currentMtlP = sub.mtl?.p;
      if (!currentMtlP || validMtlIds.has(currentMtlP)) continue;
      if (!wrongGroups[currentMtlP]) wrongGroups[currentMtlP] = [];
      wrongGroups[currentMtlP].push(sub);
    }

    const srcParentIds = Object.keys(wrongGroups);
    logger.info('recreate-missing-mtl-parents: orphaned groups found', { migrationId: id, groups: srcParentIds.length, totalSubUnits: subUnitDetails.filter(s => !validMtlIds.has(s.mtl?.p)).length });

    const report = {
      dryRun,
      orphanedGroups: srcParentIds.length,
      totalOrphanedSubUnits: Object.values(wrongGroups).reduce((sum, g) => sum + g.length, 0),
      groups: [],
    };

    res.status(202).json({ message: 'recreate-missing-mtl-parents started', dryRun, report });

    if (dryRun) {
      // Just fetch source parents for the report
      const srcParents = await sourceClient.getListingsByIds(srcParentIds);
      for (const sp of srcParents) {
        const subUnits = wrongGroups[sp._id] || [];
        report.groups.push({
          srcParentId: sp._id,
          srcParentNick: sp.nickname,
          subUnitCount: subUnits.length,
          alreadyInDest: !!destNickToParentId[sp.nickname],
          subUnits: subUnits.map(s => ({ id: s._id, nick: s.nickname })),
        });
      }
      logger.info('recreate-missing-mtl-parents: dry-run complete', { migrationId: id, report });
      return;
    }

    // Step 4: for each source parent group, create dest parent if missing, then reassign sub-units
    const idMap = { ...(row.results?.listings?.idMap || {}) };
    const reversedIdMap = Object.fromEntries(Object.entries(idMap).map(([s, d]) => [d, s]));
    const idMapUpdates = {};

    // Fetch all source parents in one batch
    logger.info('recreate-missing-mtl-parents: fetching source parents', { migrationId: id, count: srcParentIds.length });
    const srcParents = await sourceClient.getListingsByIds(srcParentIds);
    const srcParentById = Object.fromEntries(srcParents.map(p => [p._id, p]));

    for (const srcParentId of srcParentIds) {
      const srcParent = srcParentById[srcParentId];
      if (!srcParent) {
        logger.warn('recreate-missing-mtl-parents: source parent not found', { migrationId: id, srcParentId });
        continue;
      }

      const subUnits = wrongGroups[srcParentId] || [];
      logger.info('recreate-missing-mtl-parents: processing group', {
        migrationId: id, srcParentNick: srcParent.nickname, subUnitCount: subUnits.length,
      });

      // Check if dest already has a parent with this nickname
      let destParentListingId = destNickToParentId[srcParent.nickname] || null;
      let destParentMtlId = destParentListingId ? destParentMap[destParentListingId]?.mtlId : null;

      if (!destParentListingId) {
        // Create new dest MTL parent from source parent data
        try {
          const payload = cleanForRecreate(srcParent);
          // Ensure type is MTL and no child fields are set
          payload.type = 'MTL';
          delete payload.parentId;
          // Include source mtl._id so Guesty adopts it as the dest parent's mtl._id.
          // Stripping mtl entirely causes Guesty to create the parent without an mtl
          // identity, making it impossible to wire sub-units via mtl.p.
          payload.mtl = srcParent.mtl?._id ? { _id: srcParent.mtl._id } : {};

          logger.info('recreate-missing-mtl-parents: creating dest parent', { migrationId: id, srcParentNick: srcParent.nickname });
          const created = await destClient.request('POST', '/listings', payload);
          destParentListingId = created?._id;
          destParentMtlId = created?.mtl?._id;

          if (!destParentListingId) {
            logger.error('recreate-missing-mtl-parents: no _id from parent creation', { migrationId: id, srcParentNick: srcParent.nickname });
            continue;
          }

          logger.info('recreate-missing-mtl-parents: created dest parent', {
            migrationId: id, srcParentNick: srcParent.nickname, destParentListingId, destParentMtlId,
          });

          // Update dest lookup maps so subsequent groups don't re-create
          destParentMap[destParentListingId] = { mtlId: destParentMtlId, title: srcParent.nickname };
          destNickToParentId[srcParent.nickname] = destParentListingId;
          validMtlIds.add(destParentMtlId);

          // Track source→dest idMap for the newly created parent
          if (srcParentId) idMapUpdates[srcParentId] = destParentListingId;
        } catch (err) {
          logger.error('recreate-missing-mtl-parents: failed to create dest parent', {
            migrationId: id, srcParentNick: srcParent.nickname, error: err.message,
          });
          continue;
        }
      } else {
        logger.info('recreate-missing-mtl-parents: dest parent already exists', {
          migrationId: id, srcParentNick: srcParent.nickname, destParentListingId,
        });
        // If bulk-listing didn't return mtl._id (Guesty omits it from bulk results),
        // fetch the parent individually to get it.
        if (!destParentMtlId) {
          try {
            const fullParent = await destClient.request('GET', '/listings/' + destParentListingId);
            destParentMtlId = fullParent.mtl?._id || null;
          } catch (_) { /* best effort */ }
        }
      }

      // Re-parent each orphaned sub-unit to the new/existing dest parent
      let ok = 0; let failed = 0;
      for (const sub of subUnits) {
        const oldDestId = sub._id;
        try {
          const fullListing = await destClient.getListingById(oldDestId);
          if (!fullListing) throw new Error('Could not fetch ' + oldDestId);

          const payload = cleanForRecreate(fullListing);
          payload.parentId = destParentListingId;
          payload.type = 'MTL_CHILD';
          payload.mtl = destParentMtlId ? { p: destParentMtlId } : undefined;
          // Guesty requires title to be a non-null string
          if (!payload.title || typeof payload.title !== 'string') {
            payload.title = String(payload.nickname || 'Untitled');
          }

          await destClient.request('DELETE', `/listings/${oldDestId}`);
          logger.info('recreate-missing-mtl-parents: deleted old sub-unit', { migrationId: id, oldDestId });

          const created = await destClient.request('POST', '/listings', payload);
          const newDestId = created?._id;
          if (!newDestId) throw new Error('No _id returned from POST for ' + oldDestId);

          logger.info('recreate-missing-mtl-parents: recreated sub-unit', {
            migrationId: id, oldDestId, newDestId, destParentListingId, srcParentNick: srcParent.nickname,
          });

          const srcSubId = reversedIdMap[oldDestId];
          if (srcSubId) idMapUpdates[srcSubId] = newDestId;
          ok++;
        } catch (err) {
          logger.error('recreate-missing-mtl-parents: failed for sub-unit', {
            migrationId: id, oldDestId, error: err.message,
          });
          failed++;
        }
      }
      logger.info('recreate-missing-mtl-parents: group complete', {
        migrationId: id, srcParentNick: srcParent.nickname, ok, failed,
      });
    }

    // Step 5: persist idMap updates
    if (Object.keys(idMapUpdates).length > 0) {
      const current = await pool.query(`SELECT results FROM migrations WHERE id = $1`, [id]);
      const existingResults = current.rows[0]?.results || {};
      const newIdMap = { ...(existingResults.listings?.idMap || {}), ...idMapUpdates };
      const updatedResults = { ...existingResults, listings: { ...existingResults.listings, idMap: newIdMap } };
      await pool.query(`UPDATE migrations SET results = $1 WHERE id = $2`, [JSON.stringify(updatedResults), id]);
      logger.info('recreate-missing-mtl-parents: idMap updated', { migrationId: id, updated: Object.keys(idMapUpdates).length });
    }

    logger.info('recreate-missing-mtl-parents: all groups complete', { migrationId: id });
  } catch (err) {
    logger.error('recreate-missing-mtl-parents error', { error: err.message, stack: err.stack });
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

// ── POST /api/admin/migrations/:id/strip-idmap-entries ──────────────────────
// Removes specific source IDs from a migration's idMap so they will be
// re-created on the next retry. Used for one-off remediation of orphaned
// sub-units that need to be re-migrated after manual deletion from Guesty.
// Body: { sourceIds: string[], resetStatus: boolean }

router.post('/migrations/:id/strip-idmap-entries', async (req, res) => {
  const { id } = req.params;
  // fullIdMap: optional — supply the complete source→dest idMap when the stored
  // results have been lost (e.g. overwritten by a re-run that skipped listings).
  // If omitted, the current results.listings.idMap is used as the base.
  const { sourceIds, resetStatus = true, fullIdMap } = req.body;

  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    return res.status(400).json({ error: 'sourceIds must be a non-empty array' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT results, status, retry_count FROM migrations WHERE id = $1',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Migration not found' });

    const { results, status, retry_count } = rows[0];
    // Use the caller-supplied idMap as the base when results have been wiped,
    // otherwise fall back to whatever is stored in the DB.
    const baseIdMap = (fullIdMap && typeof fullIdMap === 'object')
      ? fullIdMap
      : (results?.listings?.idMap || {});
    const orphanedSet = new Set(sourceIds);
    const updatedIdMap = Object.fromEntries(
      Object.entries(baseIdMap).filter(([sid]) => !orphanedSet.has(sid))
    );
    const removed = Object.keys(baseIdMap).length - Object.keys(updatedIdMap).length;

    const updatedResults = {
      ...results,
      listings: {
        ...results?.listings,
        idMap: updatedIdMap,
        migratedCount: Math.max(0, (results?.listings?.migratedCount || 0) - removed),
      },
    };

    const query = resetStatus
      ? `UPDATE migrations SET results = $1, status = 'paid', error_message = NULL,
           completed_at = NULL, started_at = NULL, last_progress_at = NULL WHERE id = $2`
      : `UPDATE migrations SET results = $1 WHERE id = $2`;

    await pool.query(query, [JSON.stringify(updatedResults), id]);

    // Also mark the listings category as 'partial' in migration_logs so the
    // engine re-enters the creation loop on re-run.  Without this, the engine
    // sees status='complete' in migration_logs and skips the listings category
    // entirely, even though we have stripped entries that need to be re-created.
    if (resetStatus) {
      await pool.query(
        `UPDATE migration_logs
         SET status = 'partial',
             migrated_count = GREATEST(0, migrated_count - $1)
         WHERE migration_id = $2 AND category = 'listings' AND status = 'complete'`,
        [removed, id]
      );
    }

    logger.info('Admin: stripped idMap entries for migration', {
      migrationId: id, requested: sourceIds.length, removed, resetStatus,
      statusBefore: status, retryCount: retry_count,
      usedFullIdMap: !!(fullIdMap),
    });

    res.json({
      success: true,
      requested: sourceIds.length,
      removed,
      idMapSizeBefore: Object.keys(baseIdMap).length,
      idMapSizeAfter: Object.keys(updatedIdMap).length,
      statusReset: resetStatus,
    });
  } catch (err) {
    logger.error('Admin: strip-idmap-entries failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
