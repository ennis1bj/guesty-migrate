const express = require('express');
const { PRICING_TIERS, ADDON_DEFINITIONS } = require('../pricing');

const router = express.Router();

// GET /api/pricing — public pricing info (no auth required)
router.get('/pricing', (req, res) => {
  const tiers = PRICING_TIERS.map(t => ({
    tier: t.tier,
    maxListings: t.maxListings,
    amountCents: t.amountCents,
    displayPrice: t.displayPrice,
    popular: t.popular,
  }));
  tiers.push({ tier: 'enterprise_plus', maxListings: null, amountCents: null, displayPrice: 'Custom', popular: false });
  res.json({ tiers, addOns: ADDON_DEFINITIONS });
});

module.exports = router;
