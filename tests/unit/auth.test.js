const { generateToken, authenticateToken } = require('../../server/auth');

function makeMockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('generateToken', () => {
  const user = { id: 'user-123', email: 'test@example.com', is_demo: false };

  test('returns a non-empty string', () => {
    const token = generateToken(user);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('token has three JWT segments', () => {
    const token = generateToken(user);
    expect(token.split('.')).toHaveLength(3);
  });

  test('demo flag is embedded in the token', () => {
    const demoUser = { id: 'demo-1', email: 'demo@example.com', is_demo: true };
    const token = generateToken(demoUser);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    expect(payload.is_demo).toBe(true);
  });

  test('non-demo flag is embedded correctly', () => {
    const token = generateToken(user);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    expect(payload.is_demo).toBe(false);
    expect(payload.email).toBe(user.email);
    expect(payload.id).toBe(user.id);
  });
});

describe('authenticateToken middleware', () => {
  const user = { id: 'user-456', email: 'mw@example.com', is_demo: false };

  test('calls next() and attaches user on valid token', () => {
    const token = generateToken(user);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeMockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: user.id, email: user.email });
  });

  test('returns 401 when no Authorization header', () => {
    const req = { headers: {} };
    const res = makeMockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 on an invalid token', () => {
    const req = { headers: { authorization: 'Bearer this.is.not.valid' } };
    const res = makeMockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header has no token part', () => {
    const req = { headers: { authorization: 'Bearer ' } };
    const res = makeMockRes();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
