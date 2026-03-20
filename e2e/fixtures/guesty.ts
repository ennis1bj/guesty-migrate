/**
 * Guesty API mock fixtures for Playwright E2E tests.
 *
 * Two mock layers are provided:
 *
 * 1. startGuestyMockServer() — HTTP server on port 4999 that intercepts
 *    backend-to-Guesty calls when the app is started with
 *    GUESTY_BASE_URL=http://127.0.0.1:4999.  Started in globalSetup.ts.
 *
 * 2. test (Playwright fixture) — extends the base test with a `guestyRoutes`
 *    fixture that applies page.route() handlers for all Guesty endpoint
 *    families (oauth2/token, /v1/listings, /v1/fees, etc.).  Guards against
 *    any browser-side Guesty leakage and documents the expected response
 *    contract per endpoint family.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { test as base } from '@playwright/test';

export const MOCK_GUESTY_PORT = 4999;

// ── Fixture data per Guesty endpoint family ───────────────────────────────────

export const GUESTY_RESPONSES = {
  oauth2Token: { access_token: 'mock-guesty-token', expires_in: 3600, token_type: 'Bearer' },
  listings: {
    results: [
      { _id: 'lst-001', nickname: 'Beach House', active: true, pictures: [], integrations: [] },
      { _id: 'lst-002', nickname: 'City Flat',   active: true, pictures: [], integrations: [] },
    ],
    count: 2,
  },
  listingCustomFields: { results: [{ _id: 'cf-lst-1', fieldId: 'cf-001', value: 'test' }], count: 1 },
  customFields:   { results: [{ _id: 'cf-001', name: 'Pet Policy' }, { _id: 'cf-002', name: 'Check-in Notes' }], count: 2 },
  rateStrategies: { results: [{ _id: 'rs-001', name: 'Standard' }], count: 1 },
  fees:           { results: [{ _id: 'fee-001', name: 'Cleaning' }, { _id: 'fee-002', name: 'Pet' }], count: 2 },
  taxes:          { results: [{ _id: 'tax-001', name: 'City Tax' }], count: 1 },
  guests:         { results: [{ _id: 'g-001', email: 'a@ex.com' }, { _id: 'g-002', email: 'b@ex.com' }, { _id: 'g-003', email: 'c@ex.com' }], count: 3 },
  owners:         { results: [{ _id: 'o-001', email: 'owner@ex.com' }], count: 1 },
  savedReplies:   { results: [{ _id: 'sr-001', title: 'Welcome' }, { _id: 'sr-002', title: 'Checkout' }], count: 2 },
  reservations:   { results: [{ _id: 'r-001' }, { _id: 'r-002' }, { _id: 'r-003' }, { _id: 'r-004' }], count: 4 },
  automations:    { results: [{ _id: 'auto-001', name: 'Post-checkout' }], count: 1 },
  tasks:          { results: [{ _id: 'task-001', title: 'Inspect' }, { _id: 'task-002', title: 'Restock' }], count: 2 },
};

// ── Playwright fixture: page.route() handlers for every Guesty endpoint family ─

export type GuestyFixtures = { guestyRoutes: void };

export const test = base.extend<GuestyFixtures>({
  guestyRoutes: async ({ context }, use) => {
    const r = GUESTY_RESPONSES;

    // Auth
    await context.route('**/oauth2/token', (route) => route.fulfill({ json: r.oauth2Token }));

    // Listings endpoint family
    await context.route('**/v1/listings', (route) => route.fulfill({ json: r.listings }));
    await context.route('**/v1/listings/*/custom-fields', (route) => route.fulfill({ json: r.listingCustomFields }));
    await context.route('**/v1/listings/*/calendar/block', (route) => route.fulfill({ json: { success: true } }));

    // Data endpoint families
    await context.route('**/v1/custom-fields', (route) => route.fulfill({ json: r.customFields }));
    await context.route('**/v1/rate-strategies', (route) => route.fulfill({ json: r.rateStrategies }));
    await context.route('**/v1/fees', (route) => route.fulfill({ json: r.fees }));
    await context.route('**/v1/taxes', (route) => route.fulfill({ json: r.taxes }));
    await context.route('**/v1/guests', (route) => route.fulfill({ json: r.guests }));
    await context.route('**/v1/owners', (route) => route.fulfill({ json: r.owners }));
    await context.route('**/v1/saved-replies', (route) => route.fulfill({ json: r.savedReplies }));
    await context.route('**/v1/reservations', (route) => route.fulfill({ json: r.reservations }));
    await context.route('**/v1/automations', (route) => route.fulfill({ json: r.automations }));
    await context.route('**/v1/tasks-open-api/tasks', (route) => route.fulfill({ json: r.tasks }));

    // Generic create (POST any /v1/* path not covered above)
    await context.route('**/v1/**', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 201, json: { _id: `created-${Date.now()}` } });
      } else {
        route.continue();
      }
    });

    await use();
  },
});

export { expect } from '@playwright/test';

// ── HTTP mock server (for backend-level Guesty interception) ──────────────────

function jsonReply(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

let _idSeq = 0;

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const { method, url = '/' } = req;
  const path = url.split('?')[0];
  const r = GUESTY_RESPONSES;

  if (method === 'POST' && path === '/oauth2/token')           return jsonReply(res, 200, r.oauth2Token);
  if (method === 'GET'  && path === '/v1/listings')            return jsonReply(res, 200, r.listings);
  if (method === 'GET'  && /^\/v1\/listings\/[^/]+\/custom-fields$/.test(path)) return jsonReply(res, 200, r.listingCustomFields);
  if (method === 'POST' && /^\/v1\/listings\/[^/]+\/calendar\/block$/.test(path)) return jsonReply(res, 200, { success: true });
  if (method === 'GET'  && path === '/v1/custom-fields')       return jsonReply(res, 200, r.customFields);
  if (method === 'GET'  && path === '/v1/rate-strategies')     return jsonReply(res, 200, r.rateStrategies);
  if (method === 'GET'  && path === '/v1/fees')                return jsonReply(res, 200, r.fees);
  if (method === 'GET'  && path === '/v1/taxes')               return jsonReply(res, 200, r.taxes);
  if (method === 'GET'  && path === '/v1/guests')              return jsonReply(res, 200, r.guests);
  if (method === 'GET'  && path === '/v1/owners')              return jsonReply(res, 200, r.owners);
  if (method === 'GET'  && path === '/v1/saved-replies')       return jsonReply(res, 200, r.savedReplies);
  if (method === 'GET'  && path === '/v1/reservations')        return jsonReply(res, 200, r.reservations);
  if (method === 'GET'  && path === '/v1/automations')         return jsonReply(res, 200, r.automations);
  if (method === 'GET'  && path === '/v1/tasks-open-api/tasks') return jsonReply(res, 200, r.tasks);
  if (method === 'POST')                                       return jsonReply(res, 201, { _id: `created-${++_idSeq}` });
  if (method === 'PUT' || method === 'PATCH')                  return jsonReply(res, 200, { updated: true });

  jsonReply(res, 404, { error: `Guesty mock: no handler for ${method} ${path}` });
}

export interface GuestyMockServer {
  url: string;
  stop: () => Promise<void>;
}

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
    stop: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
