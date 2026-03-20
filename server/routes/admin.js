const express = require('express');
const { pool } = require('../db');
const { authenticateToken, requireAdmin } = require('../auth');
const { logger } = require('../logger');

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
      `UPDATE users SET is_beta = true, beta_starts_at = $1, beta_expires_at = $2, beta_notes = $3 WHERE id = $4`,
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
