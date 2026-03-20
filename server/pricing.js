/**
 * Centralized pricing configuration for GuestyMigrate.
 *
 * All pricing tiers, per-listing calculations, and add-on definitions
 * live here so that the backend routes and frontend can stay in sync.
 */

const PRICING_TIERS = [
  { tier: 'starter',      maxListings: 10,  amountCents: null,   displayPrice: '$39–$149', popular: false, type: 'per_listing', baseCents: 3900, perListingCents: 1200, capCents: 14900 },
  { tier: 'growth',       maxListings: 50,  amountCents: 34900,  displayPrice: '$349',     popular: false },
  { tier: 'professional', maxListings: 150, amountCents: 69900,  displayPrice: '$699',     popular: true  },
  { tier: 'business',     maxListings: 300, amountCents: 99900,  displayPrice: '$999',     popular: false },
  { tier: 'enterprise',   maxListings: 500, amountCents: 149900, displayPrice: '$1,499',   popular: false },
];

const STRIPE_PRICE_ENV_KEYS = {
  starter:      'STRIPE_PRICE_STARTER',
  growth:       'STRIPE_PRICE_GROWTH',
  professional: 'STRIPE_PRICE_PROFESSIONAL',
  business:     'STRIPE_PRICE_BUSINESS',
  enterprise:   'STRIPE_PRICE_ENTERPRISE',
};

const ADDON_DEFINITIONS = [
  { key: 'priority',  name: 'Priority Processing',        description: 'Skip the queue — your migration runs first.',                              priceCents: 9900,  envKey: 'STRIPE_PRICE_ADDON_PRIORITY'  },
  { key: 'support',   name: 'Dedicated Support & Review', description: 'A migration specialist reviews your setup and assists during the process.', priceCents: 14900, envKey: 'STRIPE_PRICE_ADDON_SUPPORT'   },
  { key: 'remigrate', name: 'Re-Migration Pass',          description: 'One free re-run within 30 days if you need to migrate again.',              priceCents: 7900,  envKey: 'STRIPE_PRICE_ADDON_REMIGRATE' },
  { key: 'verify',    name: 'Post-Migration Verify Call', description: '30-minute video call to walk through your destination account.',            priceCents: 9900,  envKey: 'STRIPE_PRICE_ADDON_VERIFY'    },
];

/**
 * Calculate the starter tier price for 1-10 listings.
 * Formula: max($39, $39 + $12 * listingCount), capped at $149
 * @param {number} count - number of listings (1-10)
 * @returns {number} price in cents
 */
function calculateStarterTierCents(count) {
  const computed = 3900 + 1200 * count;
  return Math.min(Math.max(3900, computed), 14900);
}

/**
 * Get tier info from a listing count.
 * @param {number} count
 * @returns {{ tier: string, amountCents?: number, priceEnvKey?: string, requiresQuote?: boolean }}
 */
function getTierFromListings(count) {
  for (const t of PRICING_TIERS) {
    if (count <= t.maxListings) {
      // Starter tier uses per-listing formula
      if (t.type === 'per_listing') {
        return {
          tier: t.tier,
          amountCents: calculateStarterTierCents(count),
          priceEnvKey: STRIPE_PRICE_ENV_KEYS[t.tier],
        };
      }
      return {
        tier: t.tier,
        amountCents: t.amountCents,
        priceEnvKey: STRIPE_PRICE_ENV_KEYS[t.tier],
      };
    }
  }
  return { tier: 'enterprise_plus', requiresQuote: true };
}

/**
 * Compute per-listing graduated price in cents.
 *   For 1-10 listings: $39 base + $12/listing (capped at $149)
 *   Base fee: $79 flat
 *   Listings 1–50:   $8.00 each
 *   Listings 51–200: $5.00 each
 *   Listings 201+:   $3.00 each
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

/**
 * Build the add-on env key map from the definitions array.
 * @returns {Record<string, string>}
 */
function getAddonPriceMap() {
  const map = {};
  for (const a of ADDON_DEFINITIONS) {
    map[a.key] = a.envKey;
  }
  return map;
}

module.exports = {
  PRICING_TIERS,
  ADDON_DEFINITIONS,
  getTierFromListings,
  calculatePerListingCents,
  calculateStarterTierCents,
  getAddonPriceMap,
};
