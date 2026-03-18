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

        await enqueueMigration(migrationId);
        console.log(`Migration ${migrationId} paid and enqueued`);
      } catch (err) {
        console.error('Error processing payment for migration:', err);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
