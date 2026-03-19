/**
 * Tests for the structured logging module.
 */

const { logger, requestIdMiddleware } = require('../server/logger');

describe('logger', () => {
  test('exports info, warn, error, debug methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  test('child returns a logger with the same methods', () => {
    const child = logger.child({ migrationId: 'test-123' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
    expect(typeof child.debug).toBe('function');
  });

  test('info writes to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    logger.info('test message', { key: 'value' });
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0][0];
    expect(output).toContain('test message');
    spy.mockRestore();
  });

  test('error writes to stderr', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    logger.error('error msg');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('requestIdMiddleware', () => {
  test('assigns requestId and log to req', () => {
    const req = { method: 'GET', originalUrl: '/test' };
    const res = { on: jest.fn() };
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toMatch(/^req-/);
    expect(req.log).toBeDefined();
    expect(typeof req.log.info).toBe('function');
    expect(next).toHaveBeenCalled();
  });
});
