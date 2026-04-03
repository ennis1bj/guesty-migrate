/**
 * Integration tests for GET /api/health.
 *
 * Verifies that the health endpoint:
 *   - returns 200 with status "ok" when the DB is reachable
 *   - returns 503 with status "unhealthy" when the DB is unreachable
 *   - always includes a timestamp and jobs object
 */

jest.mock('express-rate-limit', () => () => (req, res, next) => next());

jest.mock('../../server/db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../server/queue', () => ({
  initQueue: jest.fn(),
  recoverStuckMigrations: jest.fn().mockResolvedValue(undefined),
  getQueueHealth: jest.fn().mockReturnValue({
    jobMode: 'in-process',
    redisAvailable: false,
    redisConfigured: false,
    degraded: false,
  }),
}));

const request = require('supertest');
const { pool } = require('../../server/db');
const app = require('../../server/index');

beforeEach(() => {
  jest.clearAllMocks();
  require('../../server/queue').getQueueHealth.mockReturnValue({
    jobMode: 'in-process',
    redisAvailable: false,
    redisConfigured: false,
    degraded: false,
  });
});

describe('GET /api/health', () => {
  test('200 ok — DB reachable, returns timestamp and jobs', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
    expect(res.body.database).toBe('connected');
    expect(res.body.jobs).toBeDefined();
    expect(res.body.jobs.jobMode).toBe('in-process');
  });

  test('200 degraded — Redis configured but unavailable', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    require('../../server/queue').getQueueHealth.mockReturnValue({
      jobMode: 'in-process',
      redisAvailable: false,
      redisConfigured: true,
      degraded: true,
    });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
  });

  test('503 unhealthy — DB unreachable', async () => {
    pool.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.database).toBe('unreachable');
    expect(res.body.jobs).toBeDefined();
  });
});
