/**
 * Fixtures for mocking /api/* endpoints at the Playwright network layer.
 *
 * Playwright's page.route() intercepts requests from the browser.
 * This covers auth, preflight, demo-activate, and status poll —
 * the same journey tested by the Supertest E2E suite, now exercised
 * through the real browser UI.
 */

export const MOCK_USER = {
  id: 'pw-user-1',
  email: 'playwright@example.com',
  is_demo: true,
  email_verified: false,
  created_at: new Date().toISOString(),
};

export const MOCK_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  Buffer.from(JSON.stringify({ id: MOCK_USER.id, email: MOCK_USER.email, is_demo: true })).toString('base64url') +
  '.mock-signature';

export const MOCK_MIGRATION_ID = 'pw-mig-001';

export const MOCK_MANIFEST = {
  listings:      2,
  custom_fields: 1,
  fees:          1,
  taxes:         1,
  rate_strategies: 0,
  guests:        1,
  owners:        0,
  reservations:  1,
  saved_replies: 0,
  automations:   0,
  tasks:         0,
};

export const MOCK_PRICING = {
  tier: 'starter',
  listingCount: 2,
  basePrice: 9900,
  total: 9900,
  requiresQuote: false,
};

export const MOCK_PREFLIGHT_RESPONSE = {
  migrationId: MOCK_MIGRATION_ID,
  manifest:    MOCK_MANIFEST,
  pricing:     MOCK_PRICING,
};

export const MOCK_STATUS_RUNNING = {
  id:     MOCK_MIGRATION_ID,
  status: 'running',
  logs:   [],
  results: null,
  diff_report: null,
};

export const MOCK_STATUS_COMPLETE = {
  id:     MOCK_MIGRATION_ID,
  status: 'complete',
  logs: [
    { category: 'custom_fields', status: 'success', source_count: 1, migrated_count: 1, failed_count: 0, skipped_count: 0 },
    { category: 'fees',          status: 'success', source_count: 1, migrated_count: 1, failed_count: 0, skipped_count: 0 },
    { category: 'taxes',         status: 'success', source_count: 1, migrated_count: 1, failed_count: 0, skipped_count: 0 },
    { category: 'listings',      status: 'success', source_count: 2, migrated_count: 2, failed_count: 0, skipped_count: 0 },
    { category: 'guests',        status: 'success', source_count: 1, migrated_count: 1, failed_count: 0, skipped_count: 0 },
    { category: 'reservations',  status: 'success', source_count: 1, migrated_count: 1, failed_count: 0, skipped_count: 0 },
  ],
  results: {
    listings: { sourceCount: 2, migratedCount: 2, failedCount: 0 },
  },
  diff_report: {
    listings: { source: 2, destination: 2, match: true },
  },
};
