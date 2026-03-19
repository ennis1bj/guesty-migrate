const { getTierFromListings, calculatePerListingCents } = require('../../server/pricing');

describe('getTierFromListings', () => {
  test('1 listing → starter tier at $149', () => {
    const result = getTierFromListings(1);
    expect(result.tier).toBe('starter');
    expect(result.amountCents).toBe(14900);
    expect(result.priceEnvKey).toBe('STRIPE_PRICE_STARTER');
  });

  test('10 listings → starter (boundary)', () => {
    expect(getTierFromListings(10).tier).toBe('starter');
  });

  test('11 listings → growth tier at $349', () => {
    const result = getTierFromListings(11);
    expect(result.tier).toBe('growth');
    expect(result.amountCents).toBe(34900);
  });

  test('50 listings → growth (boundary)', () => {
    expect(getTierFromListings(50).tier).toBe('growth');
  });

  test('51 listings → professional tier at $699', () => {
    const result = getTierFromListings(51);
    expect(result.tier).toBe('professional');
    expect(result.amountCents).toBe(69900);
  });

  test('150 listings → professional (boundary)', () => {
    expect(getTierFromListings(150).tier).toBe('professional');
  });

  test('151 listings → business tier at $999', () => {
    const result = getTierFromListings(151);
    expect(result.tier).toBe('business');
    expect(result.amountCents).toBe(99900);
  });

  test('300 listings → business (boundary)', () => {
    expect(getTierFromListings(300).tier).toBe('business');
  });

  test('301 listings → enterprise tier at $1499', () => {
    const result = getTierFromListings(301);
    expect(result.tier).toBe('enterprise');
    expect(result.amountCents).toBe(149900);
  });

  test('500 listings → enterprise (boundary)', () => {
    expect(getTierFromListings(500).tier).toBe('enterprise');
  });

  test('501 listings → enterprise_plus, requiresQuote', () => {
    const result = getTierFromListings(501);
    expect(result.tier).toBe('enterprise_plus');
    expect(result.requiresQuote).toBe(true);
    expect(result.amountCents).toBeUndefined();
  });

  test('1000 listings → enterprise_plus', () => {
    expect(getTierFromListings(1000).requiresQuote).toBe(true);
  });
});

describe('calculatePerListingCents', () => {
  test('0 listings → base fee only ($79)', () => {
    expect(calculatePerListingCents(0)).toBe(7900);
  });

  test('1 listing → $79 + $8 = $87', () => {
    expect(calculatePerListingCents(1)).toBe(7900 + 800);
  });

  test('50 listings → $79 + 50×$8 = $479', () => {
    expect(calculatePerListingCents(50)).toBe(7900 + 50 * 800);
  });

  test('51 listings → $79 + 50×$8 + 1×$5 = $484', () => {
    expect(calculatePerListingCents(51)).toBe(7900 + 50 * 800 + 1 * 500);
  });

  test('200 listings → $79 + 50×$8 + 150×$5 = $1229', () => {
    expect(calculatePerListingCents(200)).toBe(7900 + 50 * 800 + 150 * 500);
  });

  test('201 listings → $79 + 50×$8 + 150×$5 + 1×$3 = $1232', () => {
    expect(calculatePerListingCents(201)).toBe(7900 + 50 * 800 + 150 * 500 + 1 * 300);
  });

  test('300 listings → $79 + 50×$8 + 150×$5 + 100×$3 = $1529', () => {
    expect(calculatePerListingCents(300)).toBe(7900 + 50 * 800 + 150 * 500 + 100 * 300);
  });

  test('result is always a positive integer', () => {
    [1, 10, 50, 51, 100, 200, 201, 500].forEach((n) => {
      const cents = calculatePerListingCents(n);
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThan(0);
    });
  });

  test('price increases monotonically with listing count', () => {
    let prev = calculatePerListingCents(0);
    [1, 10, 50, 51, 100, 200, 201, 500].forEach((n) => {
      const curr = calculatePerListingCents(n);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    });
  });
});
