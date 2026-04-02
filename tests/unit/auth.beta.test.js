require('../setup');
const { generateToken, authenticateToken, requireAdmin } = require('../../server/auth');
const jwt = require('jsonwebtoken');

jest.mock('../../server/db', () => ({
  pool: { query: jest.fn() },
}));
const { pool } = require('../../server/db');

describe('generateToken — beta & admin fields', () => {
  test('includes is_beta, beta_expires_at, is_admin in JWT payload', () => {
    const user = {
      id: 'u1',
      email: 'beta@example.com',
      is_demo: false,
      is_beta: true,
      beta_expires_at: '2026-12-31T00:00:00Z',
      is_admin: false,
    };

    const token = generateToken(user);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    expect(decoded.is_beta).toBe(true);
    expect(decoded.beta_expires_at).toBe('2026-12-31T00:00:00Z');
    expect(decoded.is_admin).toBe(false);
  });

  test('defaults is_beta and is_admin to false when not set', () => {
    const user = { id: 'u2', email: 'plain@example.com' };
    const token = generateToken(user);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    expect(decoded.is_beta).toBe(false);
    expect(decoded.beta_expires_at).toBeNull();
    expect(decoded.is_admin).toBe(false);
  });

  test('admin user has is_admin = true in token', () => {
    const user = { id: 'u3', email: 'admin@example.com', is_admin: true };
    const token = generateToken(user);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    expect(decoded.is_admin).toBe(true);
  });
});

describe('requireAdmin middleware', () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls next() for admin users (DB confirms is_admin)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ is_admin: true }] });

    const req = { user: { id: 'u1', is_admin: true } };
    const res = mockRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 403 when DB does not confirm is_admin', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ is_admin: false }] });

    const req = { user: { id: 'u1', is_admin: true } };
    const res = mockRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 for non-admin users (early return, no DB call)', async () => {
    const req = { user: { id: 'u1', is_admin: false } };
    const res = mockRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('returns 403 when user is missing', async () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('returns 403 when is_admin is undefined', async () => {
    const req = { user: { id: 'u1' } };
    const res = mockRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('returns 500 when DB throws', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB error'));

    const req = { user: { id: 'u1', is_admin: true } };
    const res = mockRes();
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
