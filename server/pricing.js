/**
 * Centralized pricing configuration for GuestyMigrate.
 *
 * All pricing tiers, per-listing calculations, and add-on definitions
 * live here so that the backend routes and frontend can stay in sync.
 */

const PRICING_TIERS = [
  { tier: 'growth',       maxListings: 50,  amountCents: 34900,  displayPrice: '$349',     popular: false },
  { tier: 'professional', maxListings: 150, amountCents: 69900,  displayPrice: '$699',     popular: true  },
  { tier: 'business',     maxListings: 300, amountCents: 99900,  displayPrice: '$999',     popular: false },
  { tier: 'enterprise',   maxListings: 500, amountCents: 149900, displayPrice: '$1,499',   popular: false },
];

const STRIPE_PRICE_ENV_KEYS = {
  growth:       'STRIPE_PRICE_GROWTH',
  professional: 'STRIPE_PRICE_PROFESSIONAL',
  business:     'STRIPE_PRICE_BUSINESS',
  enterprise:   'STRIPE_PRICE_ENTERPRISE',
};

const ADDON_DEFINITIONS = [
  { key: 'priority',         name: 'Priority Processing',           description: 'Skip the queue — your migration runs first.',                              priceCents: 9900,  envKey: 'STRIPE_PRICE_ADDON_PRIORITY'          },
  { key: 'support',          name: 'Dedicated Support & Review',    description: 'A migration specialist reviews your setup and assists during the process.', priceCents: 14900, envKey: 'STRIPE_PRICE_ADDON_SUPPORT'           },
  { key: 'remigrate',        name: 'Re-Migration Pass',             description: 'One free re-run within 30 days if you need to migrate again.',              priceCents: 7900,  envKey: 'STRIPE_PRICE_ADDON_REMIGRATE'         },
  { key: 'verify',           name: 'Post-Migration Verify Call',    description: '30-minute video call to walk through your destination account.',            priceCents: 9900,  envKey: 'STRIPE_PRICE_ADDON_VERIFY'            },
  { key: 'pricing_snapshot', name: 'Pricing Calendar Snapshot',     description: 'Copy 2 years of nightly price + min-night overrides as hard calendar values.', priceCents: 14900, envKey: 'STRIPE_ADDON_PRICING_SNAPSHOT' },
];

/**
 * Get tier info from a listing count.
 * Accounts with 10 or fewer listings use per-listing pricing.
 * Flat tiers start at Growth (11–50 listings).
 * @param {number} count
 * @returns {{ tier: string, amountCents?: number, priceEnvKey?: string, requiresQuote?: boolean }}
 */
function getTierFromListings(count) {
  // Small accounts (1–10 listings) use per-listing pricing, not a flat tier
  if (count <= 10) {
    return {
      tier: 'per_listing',
      amountCents: calculatePerListingCents(count),
    };
  }
  for (const t of PRICING_TIERS) {
    if (count <= t.maxListings) {
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
 *   Base fee: $79 flat
 *   Listings 1–50:   $8.00 each
 *   Listings 51–200: $5.00 each
 *   Listings 201+:   $3.00 each
 *
 * Used for accounts with 1–10 listings (replacing the old flat starter tier)
 * and for users who opt into the per-listing pricing mode.
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
  getAddonPriceMap,
};
