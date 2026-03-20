/**
 * Guesty Open API mock server fixture.
 *
 * Starts a local HTTP server that stands in for https://open-api.guesty.com
 * so that the real Express backend can be exercised end-to-end without
 * making network calls to Guesty's production API.
 *
 * All paths mirror the exact routes used by server/guestyClient.js, where
 * BASE_URL = (GUESTY_BASE_URL)/v1.  Every method below corresponds to a real
 * call site in guestyClient.js:
 *
 *   POST /oauth2/token                  — getAccessToken()
 *   GET  /v1/listings                   — getAllListings() / getCount()
 *   GET  /v1/listings/:id/custom-fields — per-listing custom field values
 *   GET  /v1/custom-fields              — getAllCustomFields() / getCount()
 *   GET  /v1/rate-strategies            — getAllRateStrategies() / getCount()
 *   GET  /v1/fees                       — getAllFees() / getCount()
 *   GET  /v1/taxes                      — getAllTaxes() / getCount()
 *   GET  /v1/guests                     — getAllGuests() / getCount()
 *   GET  /v1/owners                     — getAllOwners() / getCount()
 *   GET  /v1/saved-replies              — getAllSavedReplies() / getCount()
 *   GET  /v1/reservations               — getAllReservations() / getCount()
 *   GET  /v1/automations                — getAllAutomations() / getCount()
 *   GET  /v1/tasks-open-api/tasks       — getAllTasks() / getCount()
 *   POST /v1/listings/:id/calendar/block — blockListingCalendar()
 *   POST /v1/<any>                      — create handlers (return {_id})
 */

import http from 'http';
import { AddressInfo } from 'net';

export const MOCK_GUESTY_PORT = 4999;

function jsonReply(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function stub(type: string, n = 2) {
  return Array.from({ length: n }, (_, i) => ({ _id: `${type}-${i + 1}`, name: `${type} ${i + 1}` }));
}

function listReply(res: http.ServerResponse, type: string, n: number) {
  jsonReply(res, 200, { results: stub(type, n), count: n });
}

let _idSeq = 0;

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const { method, url = '/' } = req;
  // Strip query string for matching
  const path = url.split('?')[0];

  // ── Auth ─────────────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/oauth2/token') {
    return jsonReply(res, 200, { access_token: 'mock-guesty-token', expires_in: 3600, token_type: 'Bearer' });
  }

  // ── Listings ──────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/listings') {
    return jsonReply(res, 200, {
      results: [
        { _id: 'lst-001', nickname: 'Beach House', active: true, pictures: [], integrations: [] },
        { _id: 'lst-002', nickname: 'City Flat', active: true, pictures: [], integrations: [] },
      ],
      count: 2,
    });
  }
  // Per-listing custom field values: GET /v1/listings/:id/custom-fields
  if (method === 'GET' && /^\/v1\/listings\/[^/]+\/custom-fields$/.test(path)) {
    return jsonReply(res, 200, { results: [{ _id: 'cf-lst-1', fieldId: 'cf-001', value: 'test' }], count: 1 });
  }
  // Calendar block endpoint: POST /v1/listings/:id/calendar/block
  if (method === 'POST' && /^\/v1\/listings\/[^/]+\/calendar\/block$/.test(path)) {
    return jsonReply(res, 200, { success: true });
  }

  // ── Custom fields ─────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/custom-fields') {
    return listReply(res, 'custom_field', 2);
  }

  // ── Rate strategies (path mirrors guestyClient: /rate-strategies) ─────────
  if (method === 'GET' && path === '/v1/rate-strategies') {
    return listReply(res, 'rate_strategy', 1);
  }

  // ── Fees ──────────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/fees') {
    return listReply(res, 'fee', 2);
  }

  // ── Taxes ─────────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/taxes') {
    return listReply(res, 'tax', 1);
  }

  // ── Guests ────────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/guests') {
    return listReply(res, 'guest', 3);
  }

  // ── Owners ────────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/owners') {
    return listReply(res, 'owner', 1);
  }

  // ── Saved replies ─────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/saved-replies') {
    return listReply(res, 'saved_reply', 2);
  }

  // ── Reservations ──────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/reservations') {
    return listReply(res, 'reservation', 4);
  }

  // ── Automations (path mirrors guestyClient: /automations) ─────────────────
  if (method === 'GET' && path === '/v1/automations') {
    return listReply(res, 'automation', 1);
  }

  // ── Tasks (path mirrors guestyClient: /tasks-open-api/tasks) ─────────────
  if (method === 'GET' && path === '/v1/tasks-open-api/tasks') {
    return listReply(res, 'task', 2);
  }

  // ── Generic POST → create (returns a synthetic _id) ─────────────────────
  if (method === 'POST') {
    return jsonReply(res, 201, { _id: `created-${++_idSeq}` });
  }

  // ── Generic PUT/PATCH → update ────────────────────────────────────────────
  if (method === 'PUT' || method === 'PATCH') {
    return jsonReply(res, 200, { _id: path.split('/').pop(), updated: true });
  }

  // ── 404 fallback ──────────────────────────────────────────────────────────
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
    stop: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
