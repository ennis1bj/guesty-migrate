/**
 * Guesty API mock fixtures for Playwright E2E tests.
 *
 * Two mock layers are provided:
 *
 * 1. Playwright test fixture (exported `test`) — extends base test with a
 *    `guestyRoutes` fixture that applies page.route() handlers for:
 *    a) All Guesty Open API endpoint families at open-api.guesty.com
 *       (oauth2/token, /v1/listings, /v1/custom-fields, /v1/fees, /v1/taxes,
 *       /v1/rate-strategies, /v1/guests, /v1/owners, /v1/saved-replies,
 *       /v1/reservations, /v1/automations, /v1/tasks-open-api/tasks)
 *    b) The backend /api/* endpoints that aggregate and return Guesty data,
 *       so the browser journey is fully deterministic with no real backend or
 *       Guesty credentials required.
 *
 * 2. startGuestyMockServer() — HTTP server on port 4999 for backend→Guesty
 *    interception when the app is started with GUESTY_BASE_URL=http://127.0.0.1:4999.
 *    Started/stopped in e2e/globalSetup.ts and e2e/globalTeardown.ts.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { test as base } from '@playwright/test';

export const MOCK_GUESTY_PORT = 4999;
export const MOCK_MIGRATION_ID = 'mig-e2e-001';

// ── Guesty endpoint family response data ──────────────────────────────────────

export const GUESTY_RESPONSES = {
  oauth2Token:        { access_token: 'mock-guesty-token', expires_in: 3600, token_type: 'Bearer' },
  listings:           { results: [{ _id: 'lst-001', nickname: 'Beach House', active: true }, { _id: 'lst-002', nickname: 'City Flat', active: true }], count: 2 },
  listingCustomFields:{ results: [{ _id: 'cf-lst-1', fieldId: 'cf-001', value: 'test' }], count: 1 },
  customFields:       { results: [{ _id: 'cf-001', name: 'Pet Policy' }, { _id: 'cf-002', name: 'Check-in Notes' }], count: 2 },
  rateStrategies:     { results: [{ _id: 'rs-001', name: 'Standard' }], count: 1 },
  fees:               { results: [{ _id: 'fee-001', name: 'Cleaning' }, { _id: 'fee-002', name: 'Pet' }], count: 2 },
  taxes:              { results: [{ _id: 'tax-001', name: 'City Tax' }], count: 1 },
  guests:             { results: [{ _id: 'g-001', email: 'a@ex.com' }, { _id: 'g-002', email: 'b@ex.com' }, { _id: 'g-003', email: 'c@ex.com' }], count: 3 },
  owners:             { results: [{ _id: 'o-001', email: 'owner@ex.com' }], count: 1 },
  savedReplies:       { results: [{ _id: 'sr-001', title: 'Welcome' }, { _id: 'sr-002', title: 'Checkout' }], count: 2 },
  reservations:       { results: [{ _id: 'r-001' }, { _id: 'r-002' }, { _id: 'r-003' }, { _id: 'r-004' }], count: 4 },
  automations:        { results: [{ _id: 'auto-001', name: 'Post-checkout' }], count: 1 },
  tasks:              { results: [{ _id: 'task-001', title: 'Inspect' }, { _id: 'task-002', title: 'Restock' }], count: 2 },
};

// Backend API responses assembled from Guesty data (what the React frontend sees)
export const API_RESPONSES = {
  register: (email: string) => ({
    token: 'mock-jwt-token',
    user: { id: 'u-e2e-001', email, is_demo: true },
  }),
  preflight: {
    migrationId: MOCK_MIGRATION_ID,
    manifest: {
      listings: GUESTY_RESPONSES.listings.count,
      custom_fields: GUESTY_RESPONSES.customFields.count,
      fees: GUESTY_RESPONSES.fees.count,
      taxes: GUESTY_RESPONSES.taxes.count,
      guests: GUESTY_RESPONSES.guests.count,
      owners: GUESTY_RESPONSES.owners.count,
      saved_replies: GUESTY_RESPONSES.savedReplies.count,
      rate_strategies: GUESTY_RESPONSES.rateStrategies.count,
      reservations: GUESTY_RESPONSES.reservations.count,
      automations: GUESTY_RESPONSES.automations.count,
      tasks: GUESTY_RESPONSES.tasks.count,
      photos: 4,
    },
    pricing: {
      tier: 'starter',
      requiresQuote: false,
      tiers: { starter: 9900, professional: 19900, enterprise: 49900 },
      per_listing: { base: 7900, rate: 800, breakpoints: [] },
    },
  },
  demoActivate: { success: true },
  status: {
    id: MOCK_MIGRATION_ID,
    status: 'complete',
    logs: [
      { category: 'listings',      status: 'done', source_count: 2,  migrated_count: 2  },
      { category: 'custom_fields', status: 'done', source_count: 2,  migrated_count: 2  },
      { category: 'fees',          status: 'done', source_count: 2,  migrated_count: 2  },
      { category: 'taxes',         status: 'done', source_count: 1,  migrated_count: 1  },
      { category: 'guests',        status: 'done', source_count: 3,  migrated_count: 3  },
      { category: 'reservations',  status: 'done', source_count: 4,  migrated_count: 4  },
    ],
    diff_report: { matched: 2, mismatched: 0, source_only: 0, dest_only: 0 },
  },
};

// ── Playwright fixture ────────────────────────────────────────────────────────

export type GuestyFixtures = { guestyRoutes: void };

export const test = base.extend<GuestyFixtures>({
  guestyRoutes: async ({ context }, use) => {
    const gr = GUESTY_RESPONSES;

    // ── (a) Guesty Open API endpoint families (browser-side interception guard) ─
    await context.route('**/oauth2/token', (r) => r.fulfill({ json: gr.oauth2Token }));
    await context.route('**/v1/listings',  (r) => r.fulfill({ json: gr.listings }));
    await context.route('**/v1/listings/*/custom-fields', (r) => r.fulfill({ json: gr.listingCustomFields }));
    await context.route('**/v1/listings/*/calendar/block', (r) => r.fulfill({ json: { success: true } }));
    await context.route('**/v1/custom-fields',       (r) => r.fulfill({ json: gr.customFields }));
    await context.route('**/v1/rate-strategies',     (r) => r.fulfill({ json: gr.rateStrategies }));
    await context.route('**/v1/fees',                (r) => r.fulfill({ json: gr.fees }));
    await context.route('**/v1/taxes',               (r) => r.fulfill({ json: gr.taxes }));
    await context.route('**/v1/guests',              (r) => r.fulfill({ json: gr.guests }));
    await context.route('**/v1/owners',              (r) => r.fulfill({ json: gr.owners }));
    await context.route('**/v1/saved-replies',       (r) => r.fulfill({ json: gr.savedReplies }));
    await context.route('**/v1/reservations',        (r) => r.fulfill({ json: gr.reservations }));
    await context.route('**/v1/automations',         (r) => r.fulfill({ json: gr.automations }));
    await context.route('**/v1/tasks-open-api/tasks',(r) => r.fulfill({ json: gr.tasks }));
    await context.route('**/v1/**', (r) => {
      if (r.request().method() === 'POST') r.fulfill({ status: 201, json: { _id: `created-mock` } });
      else r.continue();
    });

    // ── (b) Backend /api/* endpoints — deterministic Guesty-aggregated responses ─
    await context.route('**/api/auth/register', async (r) => {
      const body = r.request().postDataJSON() as { email?: string } | null;
      r.fulfill({ status: 201, json: API_RESPONSES.register(body?.email ?? 'unknown@e2e.test') });
    });

    await context.route('**/api/auth/login', async (r) => {
      const body = r.request().postDataJSON() as { email?: string } | null;
      r.fulfill({ status: 200, json: API_RESPONSES.register(body?.email ?? 'unknown@e2e.test') });
    });

    await context.route('**/api/migrations/preflight', (r) =>
      r.fulfill({ json: API_RESPONSES.preflight })
    );

    await context.route(`**/api/migrations/${MOCK_MIGRATION_ID}/demo-activate`, (r) =>
      r.fulfill({ json: API_RESPONSES.demoActivate })
    );

    // Wildcard: any migration ID (covers unknown IDs before preflight resolves)
    await context.route('**/api/migrations/*/demo-activate', (r) =>
      r.fulfill({ json: API_RESPONSES.demoActivate })
    );

    await context.route(`**/api/migrations/${MOCK_MIGRATION_ID}/status`, (r) =>
      r.fulfill({ json: API_RESPONSES.status })
    );

    await context.route('**/api/migrations/*/status', (r) =>
      r.fulfill({ json: API_RESPONSES.status })
    );

    await use();
  },
});

export { expect } from '@playwright/test';

// ── HTTP mock server (backend-level Guesty interception, GUESTY_BASE_URL mode) ─

function jsonReply(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

let _idSeq = 0;

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const { method, url = '/' } = req;
  const path = url.split('?')[0];
  const gr = GUESTY_RESPONSES;

  if (method === 'POST' && path === '/oauth2/token')                                       return jsonReply(res, 200, gr.oauth2Token);
  if (method === 'GET'  && path === '/v1/listings')                                        return jsonReply(res, 200, gr.listings);
  if (method === 'GET'  && /^\/v1\/listings\/[^/]+\/custom-fields$/.test(path))            return jsonReply(res, 200, gr.listingCustomFields);
  if (method === 'POST' && /^\/v1\/listings\/[^/]+\/calendar\/block$/.test(path))          return jsonReply(res, 200, { success: true });
  if (method === 'GET'  && path === '/v1/custom-fields')                                   return jsonReply(res, 200, gr.customFields);
  if (method === 'GET'  && path === '/v1/rate-strategies')                                 return jsonReply(res, 200, gr.rateStrategies);
  if (method === 'GET'  && path === '/v1/fees')                                            return jsonReply(res, 200, gr.fees);
  if (method === 'GET'  && path === '/v1/taxes')                                           return jsonReply(res, 200, gr.taxes);
  if (method === 'GET'  && path === '/v1/guests')                                          return jsonReply(res, 200, gr.guests);
  if (method === 'GET'  && path === '/v1/owners')                                          return jsonReply(res, 200, gr.owners);
  if (method === 'GET'  && path === '/v1/saved-replies')                                   return jsonReply(res, 200, gr.savedReplies);
  if (method === 'GET'  && path === '/v1/reservations')                                    return jsonReply(res, 200, gr.reservations);
  if (method === 'GET'  && path === '/v1/automations')                                     return jsonReply(res, 200, gr.automations);
  if (method === 'GET'  && path === '/v1/tasks-open-api/tasks')                            return jsonReply(res, 200, gr.tasks);
  if (method === 'POST')                                                                   return jsonReply(res, 201, { _id: `created-${++_idSeq}` });
  if (method === 'PUT' || method === 'PATCH')                                              return jsonReply(res, 200, { updated: true });
  jsonReply(res, 404, { error: `Guesty mock: no handler for ${method} ${path}` });
}

export interface GuestyMockServer { url: string; stop: () => Promise<void> }

export async function startGuestyMockServer(port = MOCK_GUESTY_PORT): Promise<GuestyMockServer> {
  _idSeq = 0;
  const server = http.createServer(handleRequest);
  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    stop: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
