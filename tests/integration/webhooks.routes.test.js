/**
 * Integration tests for the Stripe webhook route (/api/webhooks/stripe).
 *
 * Covers:
 *   - 503 when Stripe env vars are missing
 *   - 400 on invalid/missing webhook signature
 *   - 200 on checkout.session.completed → migration marked paid + enqueued
 *   - 500 on DB failure (so Stripe retries)
 *   - 200 on invoice.paid → beta invoice status updated
 *   - 200 for unhandled event types (ignored gracefully)
 *
 * The raw-body middleware (express.raw) used by the webhook route requires
 * the request body to be sent as a Buffer, not JSON. supertest's .send()
 * with a Buffer and Content-Type: application/json satisfies this.
 */

jest.mock('express-rate-limit', () => () => (req, res, next) => next());

const mockConstructEvent = jest.fn();
const mockStripeFactory = jest.fn(() => ({
  webhooks: { constructEvent: mockConstructEvent },
}));
jest.mock('stripe', () => mockStripeFactory);

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
const { enqueueMigration } = require('../../server/queue');
const app = require('../../server/index');

const WEBHOOK_SECRET = 'whsec_test';
const RAW_BODY = Buffer.from('{}');

function makeEvent(type, data) {
  return { type, data: { object: data } };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  mockStripeFactory.mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }));
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

async function postWebhook(body = RAW_BODY) {
  return request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 'sig_test')
    .send(body);
}

describe('POST /api/webhooks/stripe — configuration guards', () => {
  test('503 when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await postWebhook();
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  test('503 when STRIPE_WEBHOOK_SECRET is missing', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await postWebhook();
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  test('400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });
    const res = await postWebhook();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });
});

describe('POST /api/webhooks/stripe — checkout.session.completed', () => {
  test('200 — marks migration paid and enqueues at standard priority', async () => {
    const migrationId = 'mig-webhook-001';
    mockConstructEvent.mockReturnValueOnce(
      makeEvent('checkout.session.completed', {
        metadata: { migrationId },
        amount_total: 34900,
        currency: 'usd',
        id: 'cs_test_123',
      })
    );
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ selected_addons: [] }] });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE migrations SET status = 'paid'/),
      [migrationId]
    );
    expect(enqueueMigration).toHaveBeenCalledWith(migrationId, { priority: 10 });
  });

  test('200 — enqueues at priority 1 when priority add-on is selected', async () => {
    const migrationId = 'mig-webhook-prio';
    mockConstructEvent.mockReturnValueOnce(
      makeEvent('checkout.session.completed', {
        metadata: { migrationId },
        amount_total: 44800,
        currency: 'usd',
        id: 'cs_test_456',
      })
    );
    pool.query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ selected_addons: ['priority'] }] });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(enqueueMigration).toHaveBeenCalledWith(migrationId, { priority: 1 });
  });

  test('200 — no migrationId in metadata is ignored gracefully', async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeEvent('checkout.session.completed', { metadata: {}, id: 'cs_no_id' })
    );

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(enqueueMigration).not.toHaveBeenCalled();
  });

  test('500 — DB failure returns 500 so Stripe retries', async () => {
    const migrationId = 'mig-webhook-fail';
    mockConstructEvent.mockReturnValueOnce(
      makeEvent('checkout.session.completed', {
        metadata: { migrationId },
        amount_total: 0,
        currency: 'usd',
        id: 'cs_fail',
      })
    );
    pool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await postWebhook();
    expect(res.status).toBe(500);
    expect(enqueueMigration).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/stripe — invoice.paid', () => {
  test('200 — marks beta invoice as paid', async () => {
    const stripeInvoiceId = 'in_test_beta_001';
    mockConstructEvent.mockReturnValueOnce(
      makeEvent('invoice.paid', { id: stripeInvoiceId, amount_paid: 14900 })
    );
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE beta_invoices SET status = 'paid'/),
      [stripeInvoiceId]
    );
  });
});

describe('POST /api/webhooks/stripe — unhandled event types', () => {
  test('200 — unrecognised events are acknowledged without side effects', async () => {
    mockConstructEvent.mockReturnValueOnce(
      makeEvent('customer.created', { id: 'cus_xyz' })
    );

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(enqueueMigration).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
