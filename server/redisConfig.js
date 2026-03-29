/**
 * Centralized Redis configuration module.
 *
 * Handles:
 *  - TLS support via REDIS_TLS env var (#75)
 *  - Proper REDIS_URL parsing with percent-encoded special chars (#81)
 *  - Error, close, reconnecting event handlers (#76)
 *  - Connection validation via ping (#77)
 *  - State tracking for graceful fallback (#78)
 *  - Error handlers on both ioredis client and BullMQ objects (#80)
 *
 * Fixes: #75, #76, #77, #78, #80, #81
 */

const { logger } = require('./logger');

let Redis;
try {
  Redis = require('ioredis');
} catch {
  // ioredis not installed
}

// ── State tracking (#78) ───────────────────────────────────────────────────────
let redisAvailable = false;
let reconnectTimer = null;
let reconnectFailures = 0;
const MAX_RECONNECT_FAILURES = 5; // stop loop after ~2.5 min of consecutive failures

function isRedisAvailable() {
  return redisAvailable;
}

function setRedisAvailable(value) {
  redisAvailable = value;
}

// ── URL parsing & auth handling (#81) ──────────────────────────────────────────

/**
 * Parse a REDIS_URL and return ioredis-compatible connection options.
 *
 * Supports:
 *   redis://:password@host:port          (legacy / no username)
 *   redis://username:password@host:port   (ACL / Redis 6+)
 *   rediss://...                          (implicit TLS)
 *
 * Special characters in the password are expected to be percent-encoded in the
 * URL already. If REDIS_PASSWORD is provided as a separate env var, it will be
 * used verbatim (no encoding needed).
 */
function parseRedisUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const opts = {};

    opts.host = parsed.hostname || '127.0.0.1';
    opts.port = parseInt(parsed.port, 10) || 6379;

    // Decode percent-encoded password (handles special chars like #, @, %, etc.)
    if (parsed.password) {
      opts.password = decodeURIComponent(parsed.password);
    }

    // Username: ioredis treats empty string as "default", so only set when present
    if (parsed.username && parsed.username !== '') {
      opts.username = decodeURIComponent(parsed.username);
    }

    // Database number from path (e.g. redis://host:6379/2)
    if (parsed.pathname && parsed.pathname.length > 1) {
      const db = parseInt(parsed.pathname.slice(1), 10);
      if (!isNaN(db)) opts.db = db;
    }

    // Implicit TLS if scheme is rediss://
    if (parsed.protocol === 'rediss:') {
      opts.tls = {};
    }

    return opts;
  } catch (err) {
    logger.error('Failed to parse REDIS_URL', { error: err.message });
    return null;
  }
}

// ── TLS configuration (#75) ────────────────────────────────────────────────────

function buildTlsOptions() {
  const redisTls = process.env.REDIS_TLS;
  if (!redisTls || redisTls === 'false' || redisTls === '0') {
    return undefined;
  }

  const tlsOpts = {};

  // Allow self-signed certificates when explicitly opted in
  if (
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'false' ||
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED === '0'
  ) {
    tlsOpts.rejectUnauthorized = false;
  }

  return tlsOpts;
}

// ── Connection options builder ─────────────────────────────────────────────────

/**
 * Build a complete ioredis options object from environment variables.
 *
 * Priority:
 *  1. REDIS_URL is parsed for host, port, username, password, db, and TLS (rediss://).
 *  2. REDIS_PASSWORD overrides the password from the URL if set.
 *  3. REDIS_TLS=true forces TLS regardless of the URL scheme.
 *  4. REDIS_PORT overrides the port from the URL if set.
 */
function buildConnectionOptions(overrides = {}) {
  const urlOpts = parseRedisUrl(process.env.REDIS_URL) || {};

  // Allow individual env vars to override URL-derived values
  if (process.env.REDIS_PASSWORD) {
    urlOpts.password = process.env.REDIS_PASSWORD;
  }
  if (process.env.REDIS_PORT) {
    urlOpts.port = parseInt(process.env.REDIS_PORT, 10);
  }

  // TLS: explicit env var wins, then URL-derived (rediss://), then nothing
  const envTls = buildTlsOptions();
  if (envTls !== undefined) {
    urlOpts.tls = envTls;
  }

  // Retry strategy with exponential backoff (#76)
  const retryStrategy = (times) => {
    if (times > 10) {
      logger.warn('Redis max reconnection attempts reached', { attempts: times });
      return null; // stop retrying
    }
    const delay = Math.min(times * 200, 5000); // 200ms, 400ms, ... 5s cap
    logger.info('Redis reconnecting', { attempt: times, delayMs: delay });
    return delay;
  };

  return {
    ...urlOpts,
    maxRetriesPerRequest: null, // required by BullMQ
    retryStrategy,
    enableReadyCheck: true,
    connectTimeout: 10000,
    ...overrides,
  };
}

// ── Client factory with event handlers (#76, #80) ─────────────────────────────

/**
 * Create an ioredis client with all required event handlers attached.
 *
 * @param {string} label  - descriptive label for log messages (e.g. 'bullmq-queue')
 * @param {object} [overrides] - extra ioredis options
 * @returns {import('ioredis').Redis | null}
 */
function createRedisClient(label = 'default', overrides = {}) {
  if (!Redis) {
    logger.info('ioredis not installed — Redis features disabled');
    return null;
  }

  const opts = buildConnectionOptions(overrides);
  const client = new Redis(opts);

  // ── Event handlers (#76, #80) ──────────────────────────────────────────
  client.on('error', (err) => {
    // Log but never crash
    logger.error(`Redis client error [${label}]`, {
      error: err.message,
      code: err.code,
    });
  });

  client.on('close', () => {
    logger.warn(`Redis connection closed [${label}]`);
  });

  client.on('reconnecting', (ms) => {
    logger.info(`Redis reconnecting [${label}]`, { inMs: ms });
  });

  client.on('ready', () => {
    logger.info(`Redis connection ready [${label}]`);
  });

  return client;
}

// ── Connection validation (#77) ────────────────────────────────────────────────

/**
 * Test Redis connectivity with a PING. Returns true if Redis is reachable.
 * Does NOT throw — callers decide how to handle failure.
 */
async function validateRedisConnection() {
  if (!Redis) return false;
  if (!process.env.REDIS_URL) return false;

  const client = createRedisClient('validation', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    enableReadyCheck: false,
    retryStrategy: () => null, // no retries during validation
  });

  if (!client) return false;

  // Replace the persistent error logger with a silent handler for validation
  // clients — the try/catch below already handles and logs the error once.
  client.removeAllListeners('error');
  client.removeAllListeners('close');
  client.removeAllListeners('reconnecting');
  client.on('error', () => {}); // prevent unhandled-error crash

  try {
    await client.connect();
    const pong = await client.ping();
    if (pong === 'PONG') {
      logger.info('Redis connection validated successfully');
      return true;
    }
    logger.warn('Redis ping returned unexpected response', { response: pong });
    return false;
  } catch (err) {
    const isAuthError = /WRONGPASS|NOAUTH|ERR AUTH/.test(err.message);
    const isSslError  = /SSL|TLS|ERR_SSL/.test(err.message || err.code || '');
    if (isAuthError) {
      logger.warn('Redis auth failed — check REDIS_URL credentials', { error: err.message });
    } else if (isSslError) {
      logger.warn('Redis TLS mismatch — check whether REDIS_URL should use redis:// or rediss://', { error: err.message });
    } else {
      logger.warn('Redis connection test failed', { error: err.message });
    }
    return false;
  } finally {
    try { client.disconnect(); } catch {}
  }
}

// ── Periodic reconnection (#78) ────────────────────────────────────────────────

/**
 * Start a 30-second interval that attempts to reconnect to Redis when it's
 * marked unavailable. Calls `onReconnect` when connectivity is restored.
 */
function startReconnectLoop(onReconnect) {
  if (reconnectTimer) return; // already running

  reconnectFailures = 0; // reset counter each time the loop starts

  reconnectTimer = setInterval(async () => {
    if (redisAvailable) return; // already connected, nothing to do

    logger.info('Attempting periodic Redis reconnection...');
    const ok = await validateRedisConnection();
    if (ok) {
      reconnectFailures = 0;
      logger.info('Redis is reachable again — attempting queue re-initialization');
      if (typeof onReconnect === 'function') {
        try {
          await onReconnect();
        } catch (err) {
          logger.error('Redis reconnect callback failed', { error: err.message });
        }
      }
    } else {
      reconnectFailures += 1;
      if (reconnectFailures >= MAX_RECONNECT_FAILURES) {
        logger.warn(
          `Redis unreachable after ${reconnectFailures} attempts — stopping reconnection loop. ` +
          'App will continue in in-process mode. Fix REDIS_URL to re-enable queue.'
        );
        stopReconnectLoop();
      }
    }
  }, 30_000);

  // Don't keep the process alive just for this timer
  if (reconnectTimer.unref) reconnectTimer.unref();
}

function stopReconnectLoop() {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  createRedisClient,
  buildConnectionOptions,
  parseRedisUrl,
  validateRedisConnection,
  isRedisAvailable,
  setRedisAvailable,
  startReconnectLoop,
  stopReconnectLoop,
};
