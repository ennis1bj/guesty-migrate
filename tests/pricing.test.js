/**
 * Tests for centralized pricing module.
 */

const { getTierFromListings, calculatePerListingCents, getAddonPriceMap, PRICING_TIERS, ADDON_DEFINITIONS } = require('../server/pricing');

describe('getTierFromListings', () => {
  test('returns starter for 1-10 listings', () => {
    expect(getTierFromListings(1).tier).toBe('starter');
    expect(getTierFromListings(10).tier).toBe('starter');
    expect(getTierFromListings(10).amountCents).toBe(14900);
  });

  test('returns growth for 11-50 listings', () => {
    expect(getTierFromListings(11).tier).toBe('growth');
    expect(getTierFromListings(50).tier).toBe('growth');
  });

  test('returns professional for 51-150 listings', () => {
    expect(getTierFromListings(51).tier).toBe('professional');
    expect(getTierFromListings(150).tier).toBe('professional');
  });

  test('returns business for 151-300 listings', () => {
    expect(getTierFromListings(151).tier).toBe('business');
    expect(getTierFromListings(300).tier).toBe('business');
  });

  test('returns enterprise for 301-500 listings', () => {
    expect(getTierFromListings(301).tier).toBe('enterprise');
    expect(getTierFromListings(500).tier).toBe('enterprise');
  });

  test('returns enterprise_plus requiring quote for 500+ listings', () => {
    const result = getTierFromListings(501);
    expect(result.tier).toBe('enterprise_plus');
    expect(result.requiresQuote).toBe(true);
  });
});

describe('calculatePerListingCents', () => {
  test('base fee only for 0 listings', () => {
    expect(calculatePerListingCents(0)).toBe(7900);
  });

  test('1 listing = base + 800', () => {
    expect(calculatePerListingCents(1)).toBe(7900 + 800);
  });

  test('50 listings = base + 50*800', () => {
    expect(calculatePerListingCents(50)).toBe(7900 + 50 * 800);
  });

  test('100 listings = base + 50*800 + 50*500', () => {
    expect(calculatePerListingCents(100)).toBe(7900 + 50 * 800 + 50 * 500);
  });

  test('250 listings = base + 50*800 + 150*500 + 50*300', () => {
    expect(calculatePerListingCents(250)).toBe(7900 + 50 * 800 + 150 * 500 + 50 * 300);
  });
});

describe('getAddonPriceMap', () => {
  test('returns map for all addon keys', () => {
    const map = getAddonPriceMap();
    expect(map.priority).toBe('STRIPE_PRICE_ADDON_PRIORITY');
    expect(map.support).toBe('STRIPE_PRICE_ADDON_SUPPORT');
    expect(map.remigrate).toBe('STRIPE_PRICE_ADDON_REMIGRATE');
    expect(map.verify).toBe('STRIPE_PRICE_ADDON_VERIFY');
  });
});

describe('PRICING_TIERS', () => {
  test('tiers are sorted by maxListings ascending', () => {
    for (let i = 1; i < PRICING_TIERS.length; i++) {
      expect(PRICING_TIERS[i].maxListings).toBeGreaterThan(PRICING_TIERS[i - 1].maxListings);
    }
  });

  test('exactly one tier is popular', () => {
    const popular = PRICING_TIERS.filter(t => t.popular);
    expect(popular.length).toBe(1);
    expect(popular[0].tier).toBe('professional');
  });
});

describe('ADDON_DEFINITIONS', () => {
  test('all add-ons have required fields', () => {
    for (const a of ADDON_DEFINITIONS) {
      expect(a.key).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.priceCents).toBeGreaterThan(0);
      expect(a.envKey).toBeTruthy();
    }
  });
});
