/**
 * Structured logging module with request correlation IDs.
 *
 * Uses pino for structured JSON output in production and
 * a pino-pretty-style readable format in development.
 */

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_NAMES = { 10: 'DEBUG', 20: 'INFO', 30: 'WARN', 40: 'ERROR' };

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || LOG_LEVELS.info;
const isProd = process.env.NODE_ENV === 'production';

function formatMessage(level, msg, meta = {}) {
  if (level < currentLevel) return null;

  const entry = {
    level: LEVEL_NAMES[level],
    time: new Date().toISOString(),
    msg,
    ...meta,
  };

  if (isProd) {
    return JSON.stringify(entry);
  }

  // Readable dev format
  const { level: _l, time, msg: _m, ...rest } = entry;
  const extras = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
  return `[${time}] ${entry.level} ${msg}${extras}`;
}

function write(level, msg, meta) {
  const line = formatMessage(level, msg, meta);
  if (line === null) return;
  if (level >= LOG_LEVELS.error) {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const logger = {
  debug: (msg, meta) => write(LOG_LEVELS.debug, msg, meta),
  info:  (msg, meta) => write(LOG_LEVELS.info,  msg, meta),
  warn:  (msg, meta) => write(LOG_LEVELS.warn,  msg, meta),
  error: (msg, meta) => write(LOG_LEVELS.error, msg, meta),

  /**
   * Create a child logger with preset fields (e.g. migrationId).
   */
  child(defaults) {
    return {
      debug: (msg, meta) => write(LOG_LEVELS.debug, msg, { ...defaults, ...meta }),
      info:  (msg, meta) => write(LOG_LEVELS.info,  msg, { ...defaults, ...meta }),
      warn:  (msg, meta) => write(LOG_LEVELS.warn,  msg, { ...defaults, ...meta }),
      error: (msg, meta) => write(LOG_LEVELS.error, msg, { ...defaults, ...meta }),
    };
  },
};

/**
 * Express middleware that assigns a unique request ID and logs requests.
 */
let reqCounter = 0;
function requestIdMiddleware(req, res, next) {
  reqCounter++;
  req.requestId = `req-${Date.now()}-${reqCounter}`;
  req.log = logger.child({ requestId: req.requestId });

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    req.log.info(`${req.method} ${req.originalUrl} ${res.statusCode}`, { durationMs: duration });
  });

  next();
}

module.exports = { logger, requestIdMiddleware };
