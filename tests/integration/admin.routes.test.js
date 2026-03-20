/**
 * Integration tests for admin API routes (/api/admin/*)
 *
 * Covers all 6 endpoints:
 *   GET  /api/admin/beta
 *   POST /api/admin/beta/grant
 *   POST /api/admin/beta/:userId/extend
 *   POST /api/admin/beta/:userId/revoke
 *   POST /api/admin/beta/:userId/invoice  (Stripe mocked)
 *   GET  /api/admin/users/search
 *
 * Auth guards (401/403) are verified for every route.
 * Bug policy: checkResponse / checkShape log GitHub issues on unexpected responses.
 */

// ── Env ───────────────────────────────────────────────────────────────────────
process.env.JWT_SECRET     = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.DATABASE_URL   = 'postgresql://test:test@localhost:5432/test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

// ── Stripe mock (must be before any require of server/index) ──────────────────
const mockStripeCustomers    = { list: jest.fn(), create: jest.fn() };
const mockStripeInvoiceItems = { create: jest.fn() };
const mockStripeInvoices     = { create: jest.fn(), finalizeInvoice: jest.fn(), sendInvoice: jest.fn() };

jest.mock('stripe', () =>
  jest.fn(() => ({
    customers:    mockStripeCustomers,
    invoiceItems: mockStripeInvoiceItems,
    invoices:     mockStripeInvoices,
  }))
);

// ── DB / Queue mocks ──────────────────────────────────────────────────────────
jest.mock('../../server/db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../server/queue', () => ({
  initQueue: jest.fn(),
  recoverStuckMigrations: jest.fn().mockResolvedValue(undefined),
  enqueueMigration: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const { pool } = require('../../server/db');
const { generateToken } = require('../../server/auth');
const app = require('../../server/index');

// ── GitHub issue logging ──────────────────────────────────────────────────────
const GITHUB_OWNER = 'ennis1bj';
const GITHUB_REPO  = 'guesty-migrate';

async function logGitHubIssue(title, body) {
  try {
    const { ReplitConnectors } = await import('@replit/connectors-sdk');
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy(
      'github',
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[Admin API] ${title}`,
          body: `${body}\n\n---\n*Logged automatically by the admin routes integration test suite.*`,
          labels: ['bug', 'e2e'],
        }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      console.warn(`[github-issue] HTTP ${response.status}: ${text.slice(0, 200)}`);
      return;
    }
    const issue = await response.json();
    console.info(`[github-issue] Created #${issue.number}: ${issue.html_url}`);
  } catch (err) {
    console.warn(`[github-issue] Could not create issue "${title}": ${err.message}`);
    console.warn(`[github-issue] Body:\n${body}`);
  }
}

function issueBody(action, expected, actual, context = {}) {
  const lines = [
    `**Action**: ${action}`,
    `**Expected**: ${expected}`,
    `**Actual**: ${actual}`,
    `**File**: tests/integration/admin.routes.test.js`,
  ];
  if (context.status) lines.push(`**HTTP status**: ${context.status}`);
  if (context.body)   lines.push(`**Response body**:\n\`\`\`json\n${JSON.stringify(context.body, null, 2)}\n\`\`\``);
  return lines.join('\n');
}

async function checkResponse(description, res, expectedStatus) {
  if (res.status !== expectedStatus) {
    await logGitHubIssue(
      `Unexpected HTTP status: ${description}`,
      issueBody(description, `HTTP ${expectedStatus}`, `HTTP ${res.status}`, { status: res.status, body: res.body }),
    ).catch(() => {});
  }
  return res;
}

async function checkShape(description, actual, expected) {
  const mismatches = [];
  for (const [key, val] of Object.entries(expected)) {
    if (actual[key] !== val) mismatches.push(`${key}: expected ${JSON.stringify(val)}, got ${JSON.stringify(actual[key])}`);
  }
  if (mismatches.length > 0) {
    await logGitHubIssue(
      `Unexpected response shape: ${description}`,
      issueBody(description, JSON.stringify(expected), JSON.stringify(actual), { body: actual }),
    ).catch(() => {});
  }
}

// ── Token fixtures ────────────────────────────────────────────────────────────
const ADMIN_USER    = { id: 'admin-001', email: 'admin@example.com', is_admin: true };
const REGULAR_USER  = { id: 'user-001',  email: 'user@example.com',  is_admin: false };
const ADMIN_TOKEN   = generateToken(ADMIN_USER);
const REGULAR_TOKEN = generateToken(REGULAR_USER);
const ADMIN_AUTH    = `Bearer ${ADMIN_TOKEN}`;
const REGULAR_AUTH  = `Bearer ${REGULAR_TOKEN}`;

const BETA_USER_ID = 'user-beta-001';
const BETA_PARTICIPANT = {
  id: BETA_USER_ID,
  email: 'beta@example.com',
  is_beta: true,
  beta_starts_at: '2026-01-01T00:00:00Z',
  beta_expires_at: '2027-01-01T00:00:00Z',
  beta_notes: 'Test participant',
  beta_status: 'active',
  invoices: [],
};

beforeEach(() => {
  jest.clearAllMocks();

  // Default Stripe mock responses
  mockStripeCustomers.list.mockResolvedValue({ data: [{ id: 'cus-mock-001' }] });
  mockStripeCustomers.create.mockResolvedValue({ id: 'cus-mock-new' });
  mockStripeInvoiceItems.create.mockResolvedValue({ id: 'ii-mock-001' });
  mockStripeInvoices.create.mockResolvedValue({ id: 'in-mock-001' });
  mockStripeInvoices.finalizeInvoice.mockResolvedValue({
    id: 'in-mock-001',
    hosted_invoice_url: 'https://invoice.stripe.com/mock',
  });
  mockStripeInvoices.sendInvoice.mockResolvedValue({ id: 'in-mock-001' });
});

// ══════════════════════════════════════════════════════════════════════════════
// Auth guards — every admin route
// ══════════════════════════════════════════════════════════════════════════════

describe('Admin route auth guards', () => {
  const ROUTES = [
    ['GET',  '/api/admin/beta'],
    ['POST', '/api/admin/beta/grant'],
    ['POST', `/api/admin/beta/${BETA_USER_ID}/extend`],
    ['POST', `/api/admin/beta/${BETA_USER_ID}/revoke`],
    ['POST', `/api/admin/beta/${BETA_USER_ID}/invoice`],
    ['GET',  '/api/admin/users/search?q=test'],
  ];

  for (const [method, path] of ROUTES) {
    test(`401 — ${method} ${path} with no token`, async () => {
      const res = await request(app)[method.toLowerCase()](path);
      expect(res.status).toBe(401);
    });

    test(`403 — ${method} ${path} with non-admin token`, async () => {
      const res = await request(app)[method.toLowerCase()](path)
        .set('Authorization', REGULAR_AUTH);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/beta
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/beta', () => {
  test('200 — returns empty participants array when none exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'GET /api/admin/beta (empty)',
      await request(app).get('/api/admin/beta').set('Authorization', ADMIN_AUTH),
      200,
    );

    expect(Array.isArray(res.body.participants)).toBe(true);
    expect(res.body.participants).toHaveLength(0);
  });

  test('200 — returns populated participants with invoices', async () => {
    pool.query.mockResolvedValueOnce({ rows: [BETA_PARTICIPANT] });

    const res = await checkResponse(
      'GET /api/admin/beta (with participants)',
      await request(app).get('/api/admin/beta').set('Authorization', ADMIN_AUTH),
      200,
    );

    expect(res.body.participants).toHaveLength(1);
    await checkShape('GET /api/admin/beta participant[0]', res.body.participants[0], {
      id: BETA_USER_ID,
      email: 'beta@example.com',
      beta_status: 'active',
    });
    expect(res.body.participants[0].email).toBe('beta@example.com');
    expect(res.body.participants[0].beta_status).toBe('active');
    expect(Array.isArray(res.body.participants[0].invoices)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/beta/grant
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/beta/grant', () => {
  test('200 — grants beta access to an existing user', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: BETA_USER_ID, email: 'beta@example.com' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'POST /api/admin/beta/grant (happy path)',
      await request(app)
        .post('/api/admin/beta/grant')
        .set('Authorization', ADMIN_AUTH)
        .send({ email: 'beta@example.com', expiresAt: '2027-01-01', notes: 'Test note' }),
      200,
    );

    await checkShape('POST /api/admin/beta/grant body', res.body, { success: true, userId: BETA_USER_ID });
    expect(res.body.success).toBe(true);
    expect(res.body.userId).toBe(BETA_USER_ID);
    expect(res.body.email).toBe('beta@example.com');
  });

  test('400 — rejects when email is missing', async () => {
    const res = await checkResponse(
      'POST /api/admin/beta/grant (missing email)',
      await request(app)
        .post('/api/admin/beta/grant')
        .set('Authorization', ADMIN_AUTH)
        .send({ expiresAt: '2027-01-01' }),
      400,
    );
    expect(res.body.error).toBeDefined();
  });

  test('400 — rejects when expiresAt is missing', async () => {
    const res = await checkResponse(
      'POST /api/admin/beta/grant (missing expiresAt)',
      await request(app)
        .post('/api/admin/beta/grant')
        .set('Authorization', ADMIN_AUTH)
        .send({ email: 'beta@example.com' }),
      400,
    );
    expect(res.body.error).toBeDefined();
  });

  test('404 — rejects when user email does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'POST /api/admin/beta/grant (unknown email)',
      await request(app)
        .post('/api/admin/beta/grant')
        .set('Authorization', ADMIN_AUTH)
        .send({ email: 'ghost@example.com', expiresAt: '2027-01-01' }),
      404,
    );
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/beta/:userId/extend
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/beta/:userId/extend', () => {
  test('200 — extends beta expiry for an active beta user', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: BETA_USER_ID, email: 'beta@example.com', beta_expires_at: '2028-01-01T00:00:00Z' }],
    });

    const res = await checkResponse(
      'POST /api/admin/beta/:userId/extend (happy path)',
      await request(app)
        .post(`/api/admin/beta/${BETA_USER_ID}/extend`)
        .set('Authorization', ADMIN_AUTH)
        .send({ expiresAt: '2028-01-01' }),
      200,
    );

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(BETA_USER_ID);
  });

  test('400 — rejects when expiresAt is missing', async () => {
    const res = await checkResponse(
      'POST /api/admin/beta/:userId/extend (missing expiresAt)',
      await request(app)
        .post(`/api/admin/beta/${BETA_USER_ID}/extend`)
        .set('Authorization', ADMIN_AUTH)
        .send({}),
      400,
    );
    expect(res.body.error).toBeDefined();
  });

  test('404 — rejects when user is not a beta participant', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'POST /api/admin/beta/:userId/extend (non-beta user)',
      await request(app)
        .post(`/api/admin/beta/nonexistent-id/extend`)
        .set('Authorization', ADMIN_AUTH)
        .send({ expiresAt: '2028-01-01' }),
      404,
    );
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/beta/:userId/revoke
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/beta/:userId/revoke', () => {
  test('200 — revokes beta access for an existing user', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: BETA_USER_ID, email: 'beta@example.com' }],
    });

    const res = await checkResponse(
      'POST /api/admin/beta/:userId/revoke (happy path)',
      await request(app)
        .post(`/api/admin/beta/${BETA_USER_ID}/revoke`)
        .set('Authorization', ADMIN_AUTH),
      200,
    );

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(BETA_USER_ID);
  });

  test('404 — rejects when user does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'POST /api/admin/beta/:userId/revoke (not found)',
      await request(app)
        .post('/api/admin/beta/nonexistent-id/revoke')
        .set('Authorization', ADMIN_AUTH),
      404,
    );
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/beta/:userId/invoice
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/beta/:userId/invoice', () => {
  test('200 — creates Stripe invoice and records in DB', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: BETA_USER_ID, email: 'beta@example.com' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'POST /api/admin/beta/:userId/invoice (happy path)',
      await request(app)
        .post(`/api/admin/beta/${BETA_USER_ID}/invoice`)
        .set('Authorization', ADMIN_AUTH)
        .send({ description: 'Beta Program Q1', amountCents: 50000, dueDate: '2026-06-01' }),
      200,
    );

    await checkShape('POST /api/admin/beta/:userId/invoice body', res.body, { success: true });
    expect(res.body.success).toBe(true);
    expect(res.body.invoiceId).toBe('in-mock-001');
    expect(res.body.invoiceUrl).toBe('https://invoice.stripe.com/mock');
    expect(res.body.status).toBe('open');

    expect(mockStripeCustomers.list).toHaveBeenCalled();
    expect(mockStripeInvoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50000, description: 'Beta Program Q1' })
    );
    expect(mockStripeInvoices.finalizeInvoice).toHaveBeenCalled();
    expect(mockStripeInvoices.sendInvoice).toHaveBeenCalled();
  });

  test('200 — creates a new Stripe customer when none exists', async () => {
    mockStripeCustomers.list.mockResolvedValue({ data: [] });

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: BETA_USER_ID, email: 'new@example.com' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'POST /api/admin/beta/:userId/invoice (new Stripe customer)',
      await request(app)
        .post(`/api/admin/beta/${BETA_USER_ID}/invoice`)
        .set('Authorization', ADMIN_AUTH)
        .send({ description: 'Beta Program', amountCents: 10000 }),
      200,
    );

    expect(res.body.success).toBe(true);
    expect(mockStripeCustomers.create).toHaveBeenCalledWith({ email: 'new@example.com' });
  });

  test('400 — rejects when description is missing', async () => {
    const res = await checkResponse(
      'POST /api/admin/beta/:userId/invoice (missing description)',
      await request(app)
        .post(`/api/admin/beta/${BETA_USER_ID}/invoice`)
        .set('Authorization', ADMIN_AUTH)
        .send({ amountCents: 10000 }),
      400,
    );
    expect(res.body.error).toBeDefined();
  });

  test('400 — rejects when amountCents is zero or negative', async () => {
    const res = await checkResponse(
      'POST /api/admin/beta/:userId/invoice (zero amount)',
      await request(app)
        .post(`/api/admin/beta/${BETA_USER_ID}/invoice`)
        .set('Authorization', ADMIN_AUTH)
        .send({ description: 'Test', amountCents: 0 }),
      400,
    );
    expect(res.body.error).toBeDefined();
  });

  test('404 — rejects when user does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'POST /api/admin/beta/:userId/invoice (user not found)',
      await request(app)
        .post('/api/admin/beta/nonexistent-id/invoice')
        .set('Authorization', ADMIN_AUTH)
        .send({ description: 'Beta', amountCents: 10000 }),
      404,
    );
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/users/search
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/users/search', () => {
  test('200 — returns matching users', async () => {
    const mockUsers = [
      { id: 'u-1', email: 'alice@example.com', is_beta: false, beta_expires_at: null, is_admin: false, created_at: '2026-01-01' },
      { id: 'u-2', email: 'alice.beta@example.com', is_beta: true, beta_expires_at: '2027-01-01', is_admin: false, created_at: '2026-02-01' },
    ];
    pool.query.mockResolvedValueOnce({ rows: mockUsers });

    const res = await checkResponse(
      'GET /api/admin/users/search (matching results)',
      await request(app)
        .get('/api/admin/users/search?q=alice')
        .set('Authorization', ADMIN_AUTH),
      200,
    );

    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users[0].email).toBe('alice@example.com');
    expect(res.body.users[1].is_beta).toBe(true);
  });

  test('200 — returns empty array when no users match', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await checkResponse(
      'GET /api/admin/users/search (no matches)',
      await request(app)
        .get('/api/admin/users/search?q=zzznomatch')
        .set('Authorization', ADMIN_AUTH),
      200,
    );

    expect(res.body.users).toHaveLength(0);
  });

  test('400 — rejects when query is too short (< 2 chars)', async () => {
    const res = await checkResponse(
      'GET /api/admin/users/search (query too short)',
      await request(app)
        .get('/api/admin/users/search?q=a')
        .set('Authorization', ADMIN_AUTH),
      400,
    );
    expect(res.body.error).toBeDefined();
  });

  test('400 — rejects when query param is absent', async () => {
    const res = await checkResponse(
      'GET /api/admin/users/search (no query param)',
      await request(app)
        .get('/api/admin/users/search')
        .set('Authorization', ADMIN_AUTH),
      400,
    );
    expect(res.body.error).toBeDefined();
  });

  test('200 — response includes is_beta and is_admin flags', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'admin-u', email: 'admin@example.com', is_beta: false, beta_expires_at: null, is_admin: true, created_at: '2026-01-01' }],
    });

    const res = await request(app)
      .get('/api/admin/users/search?q=admin')
      .set('Authorization', ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.users[0].is_admin).toBe(true);
  });
});
