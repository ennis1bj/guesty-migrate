const express = require('express');
const { pool } = require('../db');
const { enqueueMigration } = require('../queue');

const router = express.Router();

// Stripe webhook — uses raw body for signature verification
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
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
        console.log(`Migration ${migrationId} paid and enqueued (priority=${priority})`);
      } catch (err) {
        console.error('Error processing payment for migration:', err);
        // Return 500 so Stripe retries the webhook instead of silently succeeding
        return res.status(500).json({ error: 'Failed to enqueue migration' });
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
