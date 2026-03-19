const request = require('supertest');
const bcrypt = require('bcryptjs');

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
const app = require('../../server/index');

const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'password123';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/register', () => {
  test('201 — creates a new user and returns token + user', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'uuid-1', email: TEST_EMAIL, is_demo: false, created_at: new Date() }],
      });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.is_demo).toBe(false);
  });

  test('400 — rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('400 — rejects short password (< 6 chars)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: '123' });

    expect(res.status).toBe(400);
  });

  test('409 — rejects duplicate email', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });
});

describe('POST /api/auth/login', () => {
  test('200 — valid credentials return token + user', async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', email: TEST_EMAIL, password_hash: passwordHash, is_demo: false }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(TEST_EMAIL);
  });

  test('401 — user not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  test('401 — wrong password', async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', email: TEST_EMAIL, password_hash: passwordHash, is_demo: false }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  test('400 — missing password field', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(400);
  });

  test('400 — invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bad-email', password: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });
});
