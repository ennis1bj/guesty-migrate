const express = require('express');
const { pool } = require('../db');
const { enqueueMigration } = require('../queue');
const { logger } = require('../logger');
const { OperatorDeck } = require('../operatordeck');

const router = express.Router();

// Stripe webhook — uses raw body for signature verification
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    logger.error('Stripe webhook called but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { error: err.message });
    OperatorDeck.error('stripe.webhook_signature_failed', { message: err.message });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const migrationId = session.metadata?.migrationId;

    if (migrationId) {
      try {
        await pool.query(
          "UPDATE migrations SET status = 'paid' WHERE id = $1 AND status = 'pending'",
          [migrationId]
        );

        // Check for priority processing add-on
        const migResult = await pool.query(
          'SELECT selected_addons FROM migrations WHERE id = $1',
          [migrationId]
        );
        const addons = migResult.rows[0]?.selected_addons || [];
        const priority = addons.includes('priority') ? 1 : 10;

        await enqueueMigration(migrationId, { priority });
        logger.info(`Migration ${migrationId} paid and enqueued`, { priority });
        OperatorDeck.event('payment.success', {
          migrationId,
          amount: session.amount_total,
          currency: session.currency,
          stripeSessionId: session.id,
        });
      } catch (err) {
        logger.error('Error processing payment for migration', { error: err.message, migrationId });
        OperatorDeck.error('payment.processing_error', { message: err.message, stack: err.stack, migrationId });
        // Return 500 so Stripe retries the webhook instead of silently succeeding
        return res.status(500).json({ error: 'Failed to enqueue migration' });
      }
    }
  }

  // ── Beta invoice paid ───────────────────────────────────────────────────────
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const stripeInvoiceId = invoice.id;

    try {
      await pool.query(
        `UPDATE beta_invoices SET status = 'paid', updated_at = NOW() WHERE stripe_invoice_id = $1`,
        [stripeInvoiceId]
      );
      logger.info(`Beta invoice ${stripeInvoiceId} marked as paid`);
      OperatorDeck.event('payment.beta_invoice_paid', { stripeInvoiceId, amount: invoice.amount_paid });
    } catch (err) {
      logger.error('Error updating beta invoice status', { error: err.message, stripeInvoiceId });
      OperatorDeck.error('payment.beta_invoice_error', { message: err.message, stack: err.stack, stripeInvoiceId });
    }
  }

  res.json({ received: true });
});

module.exports = router;
