const request = require('supertest');
const { generateToken } = require('../../server/auth');

jest.mock('express-rate-limit', () => () => (req, res, next) => next());

const mockGetAccessToken   = jest.fn().mockResolvedValue('tok');
const mockGetAccountId     = jest.fn().mockResolvedValue('acct-1');
const mockGetAllListings   = jest.fn().mockResolvedValue([]);
const mockGetCount         = jest.fn().mockResolvedValue(0);

jest.mock('../../server/guestyClient', () =>
  jest.fn().mockImplementation(() => ({
    getAccessToken: mockGetAccessToken,
    getAccountId:   mockGetAccountId,
    getAllListings: mockGetAllListings,
    getCount:       mockGetCount,
  }))
);

jest.mock('../../server/db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../server/queue', () => ({
  initQueue: jest.fn(),
  recoverStuckMigrations: jest.fn().mockResolvedValue(undefined),
  enqueueMigration: jest.fn().mockResolvedValue(undefined),
}));

const MOCK_STRIPE_SESSION = { id: 'cs_test_session_123', url: 'https://checkout.stripe.com/test' };
const mockStripeSessionCreate = jest.fn().mockResolvedValue(MOCK_STRIPE_SESSION);
jest.mock('stripe', () =>
  jest.fn(() => ({
    checkout: { sessions: { create: mockStripeSessionCreate } },
  }))
);

const { pool } = require('../../server/db');
const { enqueueMigration } = require('../../server/queue');
const app = require('../../server/index');

const USER = { id: 'user-abc', email: 'user@example.com', is_demo: false };
const DEMO_USER = { id: 'demo-xyz', email: 'demo@example.com', is_demo: true };
const TOKEN = generateToken(USER);
const DEMO_TOKEN = generateToken(DEMO_USER);
const AUTH = `Bearer ${TOKEN}`;
const DEMO_AUTH = `Bearer ${DEMO_TOKEN}`;

const MIGRATION_ID = 'mig-001';
const PENDING_MIGRATION = {
  id: MIGRATION_ID,
  user_id: USER.id,
  status: 'pending',
  manifest: { listings: 5, custom_fields: 2, fees: 1, reservations: 10, guests: 8, owners: 2, tasks: 0, photos: 20 },
  selected_categories: null,
  selected_addons: [],
  pricing_mode: 'flat_tier',
  stripe_session_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/migrations — list migrations', () => {
  test('200 — returns migrations array for authenticated user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [PENDING_MIGRATION] });

    const res = await request(app)
      .get('/api/migrations')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.migrations)).toBe(true);
    expect(res.body.migrations[0].id).toBe(MIGRATION_ID);
  });

  test('401 — rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/migrations');
    expect(res.status).toBe(401);
  });

  test('403 — rejects a tampered token', async () => {
    const res = await request(app)
      .get('/api/migrations')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/migrations/:id/status', () => {
  test('200 — returns migration with logs', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [PENDING_MIGRATION] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/migrations/${MIGRATION_ID}/status`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(MIGRATION_ID);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  test('404 — migration not found for this user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/migrations/nonexistent/status')
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/migrations/:id/report', () => {
  test('200 — returns diff report', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ diff_report: { listings: { matched: 5 } } }],
    });

    const res = await request(app)
      .get(`/api/migrations/${MIGRATION_ID}/report`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.diffReport).toBeDefined();
  });

  test('404 — report not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/migrations/ghost/report')
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/migrations/:id/retry', () => {
  const FAILED_MIGRATION = { ...PENDING_MIGRATION, status: 'failed', selected_addons: [] };

  test('200 — re-enqueues a failed migration', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [FAILED_MIGRATION] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/retry`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(enqueueMigration).toHaveBeenCalledWith(MIGRATION_ID, { priority: 10 });
  });

  test('200 — priority add-on sets job priority=1', async () => {
    const priorityMigration = { ...FAILED_MIGRATION, selected_addons: ['priority'] };
    pool.query
      .mockResolvedValueOnce({ rows: [priorityMigration] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/retry`)
      .set('Authorization', AUTH);

    expect(enqueueMigration).toHaveBeenCalledWith(MIGRATION_ID, { priority: 1 });
  });

  test('404 — non-retryable migration', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/migrations/not-failed/retry')
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/migrations/:id/demo-activate', () => {
  test('200 — demo user can activate', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...PENDING_MIGRATION, user_id: DEMO_USER.id }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/demo-activate`)
      .set('Authorization', DEMO_AUTH)
      .send({ selectedCategories: ['listings', 'guests'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(enqueueMigration).toHaveBeenCalledWith(MIGRATION_ID);
  });

  test('403 — non-demo user is rejected', async () => {
    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/demo-activate`)
      .set('Authorization', AUTH)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/demo/i);
  });

  test('404 — pending migration not found for demo user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/migrations/ghost/demo-activate')
      .set('Authorization', DEMO_AUTH)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ── POST /api/migrations/:id/checkout ────────────────────────────────────────

const NON_BETA_USER = { is_beta: false, beta_expires_at: null };
const ACTIVE_BETA_USER = {
  is_beta: true,
  beta_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};
const EXPIRED_BETA_USER = {
  is_beta: true,
  beta_expires_at: new Date(Date.now() - 1000).toISOString(),
};
const MEDIUM_MIGRATION = {
  ...PENDING_MIGRATION,
  manifest: { listings: 20, custom_fields: 2, fees: 1, reservations: 10, guests: 8, owners: 2, tasks: 0, photos: 20 },
};
const ENTERPRISE_MIGRATION = {
  ...PENDING_MIGRATION,
  manifest: { listings: 600, custom_fields: 2, fees: 1, reservations: 10, guests: 8, owners: 2, tasks: 0, photos: 20 },
};

function betaCheckoutMocks(migration, betaUser) {
  pool.query
    .mockResolvedValueOnce({ rows: [migration] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [betaUser] })
    .mockResolvedValueOnce({ rows: [] });
}

function nonBetaCheckoutMocks(migration) {
  pool.query
    .mockResolvedValueOnce({ rows: [migration] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [NON_BETA_USER] })
    .mockResolvedValueOnce({ rows: [] });
}

describe('POST /api/migrations/:id/checkout', () => {
  beforeEach(() => {
    mockStripeSessionCreate.mockClear();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_PRICE_GROWTH = 'price_test_growth';
  });

  test('401 — unauthenticated request is rejected', async () => {
    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/checkout`)
      .send({ selectedCategories: ['listings'] });

    expect(res.status).toBe(401);
  });

  test('404 — migration not found returns 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/migrations/ghost-id/checkout`)
      .set('Authorization', AUTH)
      .send({ selectedCategories: ['listings'] });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('200 — beta user bypasses Stripe and enqueues at priority 1', async () => {
    betaCheckoutMocks(PENDING_MIGRATION, ACTIVE_BETA_USER);

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/checkout`)
      .set('Authorization', AUTH)
      .send({ selectedCategories: ['listings', 'guests', 'reservations'] });

    expect(res.status).toBe(200);
    expect(res.body.betaBypassed).toBe(true);
    expect(enqueueMigration).toHaveBeenCalledWith(MIGRATION_ID, { priority: 1 });
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });

  test('200 — beta checkout with large selectedListingIds (>100KB) succeeds, not 413', async () => {
    betaCheckoutMocks(PENDING_MIGRATION, ACTIVE_BETA_USER);

    const manyIds = Array.from({ length: 3500 }, (_, i) =>
      `${i.toString(16).padStart(8, '0')}-1234-5678-abcd-000000000000`
    );
    const payloadBytes = JSON.stringify({ selectedListingIds: manyIds }).length;
    expect(payloadBytes).toBeGreaterThan(100_000);

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/checkout`)
      .set('Authorization', AUTH)
      .send({ selectedCategories: ['listings'], selectedListingIds: manyIds });

    expect(res.status).toBe(200);
    expect(res.body.betaBypassed).toBe(true);
  });

  test('200 — expired beta user falls through to normal Stripe checkout', async () => {
    nonBetaCheckoutMocks(MEDIUM_MIGRATION);

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/checkout`)
      .set('Authorization', AUTH)
      .send({ selectedCategories: ['listings'], pricingMode: 'flat_tier' });

    expect(res.status).toBe(200);
    expect(res.body.betaBypassed).toBeUndefined();
    expect(res.body.checkoutUrl).toBe(MOCK_STRIPE_SESSION.url);
    expect(mockStripeSessionCreate).toHaveBeenCalledTimes(1);
  });

  test('400 — 500+ listing account returns requiresQuote without calling Stripe', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [ENTERPRISE_MIGRATION] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [NON_BETA_USER] });

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/checkout`)
      .set('Authorization', AUTH)
      .send({ selectedCategories: ['listings'] });

    expect(res.status).toBe(400);
    expect(res.body.requiresQuote).toBe(true);
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });

  test('400 — custom selection of 500+ listings triggers requiresQuote', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [PENDING_MIGRATION] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [NON_BETA_USER] });

    const bigSelection = Array.from({ length: 550 }, (_, i) =>
      `${i.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`
    );

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/checkout`)
      .set('Authorization', AUTH)
      .send({ selectedCategories: ['listings'], selectedListingIds: bigSelection });

    expect(res.status).toBe(400);
    expect(res.body.requiresQuote).toBe(true);
  });

  test('503 — checkout returns error when Stripe key is not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    nonBetaCheckoutMocks(MEDIUM_MIGRATION);

    const res = await request(app)
      .post(`/api/migrations/${MIGRATION_ID}/checkout`)
      .set('Authorization', AUTH)
      .send({ selectedCategories: ['listings'] });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/payment processing/i);
  });
});

describe('POST /api/migrations/preflight — MTL sub-unit complexId backfill', () => {
  const PREFLIGHT_BODY = {
    sourceClientId: 'src-id',
    sourceClientSecret: 'src-secret',
    destClientId: 'dst-id',
    destClientSecret: 'dst-secret',
  };

  beforeEach(() => {
    pool.query.mockReset();
    mockGetAccessToken.mockResolvedValue('tok');
    mockGetAccountId.mockResolvedValue('acct-1');
    mockGetCount.mockResolvedValue(0);
  });

  test('backfills complexId from mtl.c when Guesty omits parentId on MTL_CHILD listings', async () => {
    mockGetAllListings.mockResolvedValue([
      {
        _id: 'parent-1',
        title: 'Beach Complex',
        type: 'MTL',
        parentId: null,
        complexId: null,
        integrations: [],
        pictures: [],
        mtl: { c: ['child-1', 'child-2'] },
      },
      {
        _id: 'child-1',
        title: 'Beach Unit A',
        type: 'MTL_CHILD',
        integrations: [],
        pictures: [],
      },
      {
        _id: 'child-2',
        title: 'Beach Unit B',
        type: 'MTL_CHILD',
        integrations: [],
        pictures: [],
      },
    ]);

    pool.query
      .mockResolvedValueOnce({ rows: [{ email_verified: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'mig-backfill-1' }] });

    const res = await request(app)
      .post('/api/migrations/preflight')
      .set('Authorization', AUTH)
      .send(PREFLIGHT_BODY);

    expect(res.status).toBe(200);

    const details = res.body.manifest.listingDetails;
    const child1 = details.find(l => l.id === 'child-1');
    const child2 = details.find(l => l.id === 'child-2');
    const parent = details.find(l => l.id === 'parent-1');

    expect(child1.complexId).toBe('parent-1');
    expect(child1.parentId).toBe('parent-1');
    expect(child2.complexId).toBe('parent-1');
    expect(child2.parentId).toBe('parent-1');
    expect(parent.complexId).toBeNull();
  });

  test('backfills complexId from subListingsIds when mtl.c is absent', async () => {
    mockGetAllListings.mockResolvedValue([
      {
        _id: 'parent-2',
        title: 'Mountain Complex',
        type: 'MTL',
        parentId: null,
        complexId: null,
        subListingsIds: ['child-3'],
        integrations: [],
        pictures: [],
      },
      {
        _id: 'child-3',
        title: 'Mountain Unit A',
        type: 'MTL_CHILD',
        integrations: [],
        pictures: [],
      },
    ]);

    pool.query
      .mockResolvedValueOnce({ rows: [{ email_verified: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'mig-backfill-2' }] });

    const res = await request(app)
      .post('/api/migrations/preflight')
      .set('Authorization', AUTH)
      .send(PREFLIGHT_BODY);

    expect(res.status).toBe(200);

    const details = res.body.manifest.listingDetails;
    const child3 = details.find(l => l.id === 'child-3');
    expect(child3.complexId).toBe('parent-2');
    expect(child3.parentId).toBe('parent-2');
  });

  test('does not overwrite complexId already set directly by the API', async () => {
    mockGetAllListings.mockResolvedValue([
      {
        _id: 'parent-3',
        title: 'City Complex',
        type: 'MTL',
        parentId: null,
        complexId: null,
        mtl: { c: ['child-4'] },
        integrations: [],
        pictures: [],
      },
      {
        _id: 'child-4',
        title: 'City Unit A',
        type: 'MTL_CHILD',
        parentId: 'parent-3',
        complexId: null,
        integrations: [],
        pictures: [],
      },
    ]);

    pool.query
      .mockResolvedValueOnce({ rows: [{ email_verified: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'mig-backfill-3' }] });

    const res = await request(app)
      .post('/api/migrations/preflight')
      .set('Authorization', AUTH)
      .send(PREFLIGHT_BODY);

    expect(res.status).toBe(200);

    const details = res.body.manifest.listingDetails;
    const child4 = details.find(l => l.id === 'child-4');
    expect(child4.complexId).toBe('parent-3');
    expect(child4.parentId).toBe('parent-3');
  });
});
