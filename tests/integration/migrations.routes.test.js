const request = require('supertest');
const { generateToken } = require('../../server/auth');

jest.mock('../../server/db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../server/queue', () => ({
  initQueue: jest.fn(),
  recoverStuckMigrations: jest.fn().mockResolvedValue(undefined),
  enqueueMigration: jest.fn().mockResolvedValue(undefined),
}));

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
