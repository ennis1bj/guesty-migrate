/**
 * E2E: Full user migration journey — API layer
 *
 * Covers: register → preflight → demo-activate → runMigration (synchronous) → status poll
 *
 * Mocking strategy:
 *   - server/db:          smart in-memory SQL handler tracking users / migrations / logs
 *   - server/guestyClient: full class mock returning fixture data for all methods
 *   - server/queue:       enqueueMigration calls runMigration synchronously so the engine
 *                         completes before demo-activate responds
 */

// ── Env (must be set before any requires) ────────────────────────────────────
process.env.JWT_SECRET  = 'test-jwt-secret-that-is-long-enough-for-tests';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.DATABASE_URL   = 'postgresql://test:test@localhost:5432/test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

// ── GitHub issue logging (best-effort; falls back to console.warn) ───────────
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
          title: `[E2E API] ${title}`,
          body: `${body}\n\n---\n*Logged automatically by the API E2E journey test suite.*`,
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

// ── In-memory database state (module-level — persists across tests) ───────────
const db = {
  _uid: 0,
  _mid: 0,
  users: new Map(),
  migrations: new Map(),
  migrationLogs: [],
};

function resetDb() {
  db._uid = 0;
  db._mid = 0;
  db.users.clear();
  db.migrations.clear();
  db.migrationLogs.length = 0;
}

/**
 * Returns a plain async function suitable for pool.query.mockImplementation().
 * Uses the module-level `db` object so state is shared across all calls within
 * a test (or across tests when no reset is performed).
 */
function makeDbHandler() {
  return async function dbHandler(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // ── USERS ──────────────────────────────────────────────────────────────

    if (/select\s+id\s+from\s+users\s+where\s+email/i.test(s)) {
      const user = [...db.users.values()].find(u => u.email === params[0]);
      return { rows: user ? [{ id: user.id }] : [] };
    }

    if (/select\s+\w.*from\s+users\s+where\s+id/i.test(s)) {
      const user = db.users.get(params[0]);
      return { rows: user ? [user] : [] };
    }

    if (/insert\s+into\s+users/i.test(s)) {
      const id = `user-e2e-${++db._uid}`;
      // Mark is_demo=true so demo-activate bypasses Stripe in the E2E flow
      const user = {
        id,
        email: params[0],
        password_hash: params[1],
        is_demo: true,
        email_verified: false,
        created_at: new Date(),
      };
      db.users.set(id, user);
      return { rows: [user] };
    }

    // ── MIGRATIONS ─────────────────────────────────────────────────────────

    if (/insert\s+into\s+migrations/i.test(s)) {
      const id = `mig-e2e-${++db._mid}`;
      const manifestRaw = params[5];
      const mig = {
        id,
        user_id: params[0],
        source_client_id: params[1],
        source_client_secret: params[2],
        dest_client_id: params[3],
        dest_client_secret: params[4],
        status: 'pending',
        manifest:
          typeof manifestRaw === 'string' ? JSON.parse(manifestRaw) : manifestRaw,
        selected_categories: null,
        selected_addons: [],
        pricing_mode: 'flat_tier',
        results: null,
        diff_report: null,
        error_message: null,
        created_at: new Date(),
        completed_at: null,
      };
      db.migrations.set(id, mig);
      return { rows: [{ id }] };
    }

    // demo-activate UPDATE: status = 'paid' literal in SQL; params = [categories, id]
    if (/update\s+migrations\s+set\s+status\s*=\s*'paid',\s*selected_categories/i.test(s)) {
      const mig = db.migrations.get(params[1]);
      if (mig) {
        mig.status = 'paid';
        mig.selected_categories = Array.isArray(params[0]) ? params[0] : null;
      }
      return { rows: [] };
    }

    // General parameterised UPDATE: status = $2[, extras], WHERE id = $1
    if (/update\s+migrations\s+set\s+status\s*=\s*\$2/i.test(s)) {
      const id = params[0];
      const mig = db.migrations.get(id);
      if (mig) {
        mig.status = params[1];
        // Parse SET clause to apply additional fields (results, diff_report, error_message…)
        const setClause = s.match(/set\s+(.+?)\s+where\s+id/i)?.[1] || '';
        for (const part of setClause.split(',')) {
          const m = part.trim().match(/^(\w+)\s*=\s*\$(\d+)$/i);
          if (!m) continue;
          const [, field, phStr] = m;
          if (field.toLowerCase() === 'status') continue;
          const pIdx = parseInt(phStr, 10) - 1;
          if (pIdx < params.length) {
            const raw = params[pIdx];
            let parsed = raw;
            if (typeof raw === 'string') {
              try { parsed = JSON.parse(raw); } catch { /* keep as string */ }
            }
            mig[field] = parsed;
          }
        }
        if (['complete', 'complete_with_errors', 'failed'].includes(mig.status)) {
          mig.completed_at = new Date();
        }
      }
      return { rows: [] };
    }

    // SELECT * FROM migrations WHERE id = $1  (single param — runMigration / email)
    if (/select\s+\*\s+from\s+migrations\s+where\s+id\s*=\s*\$1\s*$/i.test(s)) {
      const mig = db.migrations.get(params[0]);
      return { rows: mig ? [{ ...mig }] : [] };
    }

    // SELECT … FROM migrations WHERE id=$1 AND user_id=$2 AND status='pending'
    if (/from\s+migrations\s+where\s+id\s*=\s*\$1\s+and\s+user_id\s*=\s*\$2\s+and\s+status\s*=\s*'pending'/i.test(s)) {
      const mig = db.migrations.get(params[0]);
      const ok = mig && mig.user_id === params[1] && mig.status === 'pending';
      return { rows: ok ? [{ ...mig }] : [] };
    }

    // SELECT … FROM migrations WHERE id=$1 AND user_id=$2 (status check / list / retry)
    if (/from\s+migrations\s+where\s+id\s*=\s*\$1\s+and\s+user_id\s*=\s*\$2/i.test(s)) {
      const mig = db.migrations.get(params[0]);
      const ok = mig && mig.user_id === params[1];
      return { rows: ok ? [{ ...mig }] : [] };
    }

    // ── MIGRATION LOGS ─────────────────────────────────────────────────────

    if (/insert\s+into\s+migration_logs/i.test(s)) {
      db.migrationLogs.push({
        migration_id: params[0],
        category: params[1],
        status: params[2],
        source_count: params[3],
        migrated_count: params[4],
        failed_count: params[5],
        skipped_count: params[6],
        error_details: params[7],
        photos: params[8],
        created_at: new Date(),
      });
      return { rows: [] };
    }

    if (/from\s+migration_logs\s+where\s+migration_id\s*=\s*\$1/i.test(s)) {
      const logs = db.migrationLogs.filter(l => l.migration_id === params[0]);
      return { rows: logs };
    }

    // ── TOKEN CACHE (GuestyClient is fully mocked — shouldn't be hit) ──────
    if (/token_cache/i.test(s)) {
      return { rows: [] };
    }

    // Default — return empty rows
    return { rows: [] };
  };
}

// ── Jest mocks ────────────────────────────────────────────────────────────────
// IMPORTANT: jest.mock calls are hoisted. The factories run before any imports.

jest.mock('../../server/db', () => ({
  pool: { query: jest.fn() },
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../server/guestyClient', () => {
  let _c = 0;
  const mk = () => ({
    getAccessToken:         jest.fn().mockResolvedValue('mock-token'),
    getAccountId:           jest.fn().mockResolvedValue('mock-account-id'),
    getAllListings:          jest.fn().mockResolvedValue([
      { _id: 'src-l1', title: 'Beach House',    pictures: ['https://ex.com/p1.jpg'], integrations: [] },
      { _id: 'src-l2', title: 'Mountain Cabin', pictures: ['https://ex.com/p2.jpg'], integrations: [] },
    ]),
    getAllCustomFields:      jest.fn().mockResolvedValue([{ _id: 'src-cf1', name: 'Pets' }]),
    getAllFees:              jest.fn().mockResolvedValue([{ _id: 'src-fee1', name: 'Cleaning', amount: 75 }]),
    getAllGuests:            jest.fn().mockResolvedValue([
      { _id: 'src-g1', email: 'guest@ex.com', firstName: 'Jane', lastName: 'Smith' },
    ]),
    getAllOwners:            jest.fn().mockResolvedValue([]),
    getAllReservations:      jest.fn().mockResolvedValue([
      { _id: 'src-r1', listingId: 'src-l1', guestId: 'src-g1', source: {} },
    ]),
    getAllSavedReplies:      jest.fn().mockResolvedValue([]),
    getAllTasks:             jest.fn().mockResolvedValue([]),
    getCount:               jest.fn().mockImplementation(async (path) => {
      if (path.includes('listings'))       return 2;
      if (path.includes('custom-fields'))  return 1;
      if (path.includes('additional-fees'))return 1;
      if (path.includes('guests'))         return 1;
      if (path.includes('reservations'))   return 1;
      if (path.includes('tasks'))          return 0;
      return 0;
    }),
    createCustomField:   jest.fn().mockImplementation(async () => ({ _id: `d-cf-${++_c}` })),
    createFee:           jest.fn().mockImplementation(async () => ({ _id: `d-fee-${++_c}` })),
    createListing:       jest.fn().mockImplementation(async () => ({ _id: `d-l-${++_c}` })),
    createGuest:         jest.fn().mockImplementation(async () => ({ _id: `d-g-${++_c}` })),
    createOwner:         jest.fn().mockImplementation(async () => ({ _id: `d-o-${++_c}` })),
    createReservation:   jest.fn().mockImplementation(async () => ({ _id: `d-r-${++_c}` })),
    createSavedReply:    jest.fn().mockImplementation(async () => ({ _id: `d-rep-${++_c}` })),
    createTask:          jest.fn().mockImplementation(async () => ({ _id: `d-task-${++_c}` })),
    uploadListingPhoto:  jest.fn().mockResolvedValue({ id: 'photo-ok' }),
    getListingCalendarBlocks: jest.fn().mockResolvedValue([]),
    blockListingCalendar:     jest.fn().mockResolvedValue({}),
    isChannelListing:         jest.fn().mockReturnValue(false),
    findGuestByEmail:         jest.fn().mockResolvedValue(null),
  });
  return jest.fn().mockImplementation(mk);
});

// Queue mock: run migration synchronously so demo-activate resolves only after
// the engine finishes, making the status poll immediately see the final state.
jest.mock('../../server/queue', () => {
  const { runMigration } = require('../../server/migrationEngine');
  return {
    initQueue:               jest.fn(),
    recoverStuckMigrations:  jest.fn().mockResolvedValue(undefined),
    enqueueMigration: jest.fn().mockImplementation(async (migrationId) => {
      await runMigration(migrationId);
    }),
  };
});

// ── Module imports (after mocks) ──────────────────────────────────────────────
const request      = require('supertest');
const { pool }     = require('../../server/db');
const { enqueueMigration } = require('../../server/queue');
const app          = require('../../server/index');

// Install the smart DB handler once before any test runs.
// clearAllMocks() does NOT reset mockImplementation, so this persists.
beforeAll(() => {
  pool.query.mockImplementation(makeDbHandler());
});

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY: all four steps share state via outer let variables
// ═════════════════════════════════════════════════════════════════════════════

describe('E2E: Full user migration journey', () => {
  let authToken;
  let userId;
  let migrationId;

  beforeAll(() => {
    // Fresh DB state for the whole journey; mock implementation is already set above.
    resetDb();
  });

  // Step 1 ─────────────────────────────────────────────────────────────────────
  test('Step 1 — register: POST /api/auth/register returns JWT + user', async () => {
    const res = await checkResponse(
      'POST /api/auth/register',
      await request(app).post('/api/auth/register').send({ email: 'e2e-journey@example.com', password: 'SecurePass123!' }),
      201,
    );

    expect(res.status).toBe(201);
    if (typeof res.body.token !== 'string') await checkShape('POST /api/auth/register body.token', res.body, { token: res.body.token });
    if (res.body.user?.email !== 'e2e-journey@example.com') await checkShape('POST /api/auth/register body.user.email', res.body.user ?? {}, { email: 'e2e-journey@example.com' });
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe('e2e-journey@example.com');
    expect(res.body.user.id).toBeDefined();

    authToken = res.body.token;
    userId    = res.body.user.id;
  });

  // Step 2 ─────────────────────────────────────────────────────────────────────
  test('Step 2 — preflight: POST /api/migrations/preflight validates credentials and returns manifest + pricing', async () => {
    const res = await checkResponse(
      'POST /api/migrations/preflight',
      await request(app)
        .post('/api/migrations/preflight')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sourceClientId:     'src-client-id',
          sourceClientSecret: 'src-client-secret',
          destClientId:       'dst-client-id',
          destClientSecret:   'dst-client-secret',
        }),
      200,
    );

    expect(res.status).toBe(200);
    if (!res.body.migrationId) await checkShape('POST /api/migrations/preflight body.migrationId', res.body, { migrationId: '(defined)' });
    expect(res.body.migrationId).toBeDefined();

    // Manifest should reflect the mocked GuestyClient data
    await checkShape('POST /api/migrations/preflight body.manifest', res.body.manifest ?? {}, { listings: 2, custom_fields: 1, fees: 1, guests: 1 });
    expect(res.body.manifest).toMatchObject({
      listings:      2,
      custom_fields: 1,
      fees:          1,
      guests:        1,
    });

    // Pricing tier should be present and not require a custom quote (2 listings → starter)
    if (!res.body.pricing?.tier) await checkShape('POST /api/migrations/preflight body.pricing', res.body.pricing ?? {}, { tier: '(defined)' });
    expect(res.body.pricing).toBeDefined();
    expect(res.body.pricing.tier).toBeDefined();
    expect(res.body.pricing.requiresQuote).not.toBe(true);

    migrationId = res.body.migrationId;
  });

  // Step 3 ─────────────────────────────────────────────────────────────────────
  test('Step 3 — demo-activate: POST /api/migrations/:id/demo-activate triggers synchronous migration', async () => {
    const res = await checkResponse(
      `POST /api/migrations/:id/demo-activate`,
      await request(app)
        .post(`/api/migrations/${migrationId}/demo-activate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ selectedCategories: ['custom_fields', 'fees', 'listings', 'guests', 'reservations'] }),
      200,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The queue mock must have been called with our migration ID
    expect(enqueueMigration).toHaveBeenCalledWith(migrationId);
  });

  // Step 4 ─────────────────────────────────────────────────────────────────────
  test('Step 4 — status poll: GET /api/migrations/:id/status returns terminal state with logs', async () => {
    const res = await checkResponse(
      `GET /api/migrations/:id/status`,
      await request(app)
        .get(`/api/migrations/${migrationId}/status`)
        .set('Authorization', `Bearer ${authToken}`),
      200,
    );

    expect(res.status).toBe(200);
    if (res.body.id !== migrationId) await checkShape('GET /api/migrations/:id/status body.id', res.body, { id: migrationId });
    expect(res.body.id).toBe(migrationId);

    const TERMINAL = ['complete', 'complete_with_errors', 'failed'];
    if (!TERMINAL.includes(res.body.status)) {
      await checkShape('GET /api/migrations/:id/status body.status terminal', { status: res.body.status }, { status: 'complete|complete_with_errors|failed' });
    }
    expect(TERMINAL).toContain(res.body.status);

    // At least one category log must have been written by runMigration
    if (!Array.isArray(res.body.logs) || res.body.logs.length === 0) {
      await checkShape('GET /api/migrations/:id/status body.logs', res.body, { logs: '(non-empty array)' });
    }
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs.length).toBeGreaterThan(0);

    const log = res.body.logs[0];
    await checkShape('GET /api/migrations/:id/status logs[0]', log, { category: log.category ?? '(missing)', status: log.status ?? '(missing)' });
    expect(log.category).toBeDefined();
    expect(log.status).toBeDefined();
    expect(typeof log.source_count).toBe('number');
    expect(typeof log.migrated_count).toBe('number');

    // Diff report is populated for non-fatal completions
    if (res.body.status !== 'failed') {
      if (!res.body.diff_report) await checkShape('GET /api/migrations/:id/status body.diff_report', res.body, { diff_report: '(defined)' });
      expect(res.body.diff_report).toBeDefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GUARD TESTS: each gets its own fresh DB state
// ═════════════════════════════════════════════════════════════════════════════

describe('E2E: Validation guards', () => {
  // Reset DB and clear mock call history before each guard test.
  // mockImplementation is NOT cleared by clearAllMocks().
  beforeEach(() => {
    resetDb();
    jest.clearAllMocks();
    pool.query.mockImplementation(makeDbHandler());
  });

  test('Preflight rejects missing credential fields (400)', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'guard1@example.com', password: 'password123' });
    const token = reg.body.token;

    const res = await request(app)
      .post('/api/migrations/preflight')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceClientId: 'only-one-field' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('Demo-activate rejects unauthenticated requests (401)', async () => {
    const res = await request(app)
      .post('/api/migrations/fake-id/demo-activate')
      .send({});

    expect(res.status).toBe(401);
  });

  test('Status returns 404 for unknown migration', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'guard2@example.com', password: 'password123' });
    const token = reg.body.token;

    const res = await request(app)
      .get('/api/migrations/does-not-exist/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('Register rejects an invalid email (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });

  test('Register rejects a short password (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.com', password: '123' });

    expect(res.status).toBe(400);
  });
});
