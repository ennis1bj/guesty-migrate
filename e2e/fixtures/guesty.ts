/**
 * Guesty Open API mock server fixture.
 *
 * Starts a local HTTP server that stands in for https://open-api.guesty.com
 * so that the real Express backend can be exercised end-to-end without
 * making network calls to Guesty's production API.
 *
 * Endpoint families implemented:
 *   POST /oauth2/token         — returns a synthetic bearer token
 *   GET  /v1/listings          — paginated listing stubs
 *   GET  /v1/listings/:id/custom-fields  — custom field stubs
 *   GET  /v1/custom-fields     — account-level custom fields
 *   GET  /v1/revenue-management/rate-strategies — rate strategy stubs
 *   GET  /v1/finance/fees      — fee stubs
 *   GET  /v1/finance/taxes     — tax stubs
 *   GET  /v1/guests            — guest stubs
 *   GET  /v1/owners            — owner stubs
 *   GET  /v1/saved-replies     — saved-reply stubs
 *   GET  /v1/reservations      — reservation stubs
 *   GET  /v1/automations/automations — automation stubs
 *   GET  /v1/tasks-management/tasks — task stubs
 *   POST /v1/*                 — generic create handler (returns _id)
 */

import http from 'http';
import { AddressInfo } from 'net';

export const MOCK_GUESTY_PORT = 4999;

type RequestHandler = (
  req: http.IncomingMessage & { body?: unknown },
  res: http.ServerResponse,
) => void;

function jsonReply(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function stub(type: string, n = 2) {
  return Array.from({ length: n }, (_, i) => ({ _id: `${type}-${i + 1}`, name: `${type} ${i + 1}` }));
}

function listReply(res: http.ServerResponse, type: string, n = 2) {
  jsonReply(res, 200, { results: stub(type, n), count: n });
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || 'null'));
      } catch {
        resolve(null);
      }
    });
  });
}

let _idSeq = 0;

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const { method, url = '/' } = req;
  const path = url.split('?')[0];

  // OAuth2 token
  if (method === 'POST' && path === '/oauth2/token') {
    return jsonReply(res, 200, { access_token: 'mock-guesty-token', expires_in: 3600, token_type: 'Bearer' });
  }

  // Listings (may include /:id/custom-fields)
  if (method === 'GET' && path === '/v1/listings') {
    return jsonReply(res, 200, {
      results: [
        { _id: 'lst-001', nickname: 'Beach House', active: true },
        { _id: 'lst-002', nickname: 'City Flat', active: true },
      ],
      count: 2,
    });
  }
  if (method === 'GET' && /^\/v1\/listings\/[^/]+\/custom-fields$/.test(path)) {
    return jsonReply(res, 200, { results: [{ _id: 'cf-lst-1', fieldId: 'cf-001', value: 'test' }], count: 1 });
  }

  // Custom fields
  if (method === 'GET' && path === '/v1/custom-fields') {
    return listReply(res, 'custom_field', 2);
  }

  // Rate strategies
  if (method === 'GET' && path === '/v1/revenue-management/rate-strategies') {
    return listReply(res, 'rate_strategy', 1);
  }

  // Fees
  if (method === 'GET' && path === '/v1/finance/fees') {
    return listReply(res, 'fee', 2);
  }

  // Taxes
  if (method === 'GET' && path === '/v1/finance/taxes') {
    return listReply(res, 'tax', 1);
  }

  // Guests
  if (method === 'GET' && path === '/v1/guests') {
    return listReply(res, 'guest', 3);
  }

  // Owners
  if (method === 'GET' && path === '/v1/owners') {
    return listReply(res, 'owner', 1);
  }

  // Saved replies
  if (method === 'GET' && path === '/v1/saved-replies') {
    return listReply(res, 'saved_reply', 2);
  }

  // Reservations
  if (method === 'GET' && path === '/v1/reservations') {
    return listReply(res, 'reservation', 4);
  }

  // Automations
  if (method === 'GET' && path === '/v1/automations/automations') {
    return listReply(res, 'automation', 1);
  }

  // Tasks
  if (method === 'GET' && path === '/v1/tasks-management/tasks') {
    return listReply(res, 'task', 2);
  }

  // Generic POST → create (returns a synthetic _id)
  if (method === 'POST') {
    return jsonReply(res, 201, { _id: `created-${++_idSeq}` });
  }

  // Generic PUT/PATCH → update
  if (method === 'PUT' || method === 'PATCH') {
    return jsonReply(res, 200, { _id: path.split('/').pop(), updated: true });
  }

  // 404 fallback
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
