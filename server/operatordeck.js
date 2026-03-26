const OPERATORDECK_HOST = process.env.OPERATORDECK_HOST || '';
const OPERATORDECK_TOKEN = process.env.OPERATORDECK_TOKEN || '';

// Internal log buffer — flushed every 5 seconds or when 50 lines accumulate
const _logBuffer = [];
let _flushTimer = null;

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    _flush();
  }, 5000);
}

async function _flush() {
  if (_logBuffer.length === 0 || !OPERATORDECK_TOKEN || !OPERATORDECK_HOST) return;
  const batch = _logBuffer.splice(0, 100);
  try {
    await fetch(`${OPERATORDECK_HOST}/api/ingest/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sdk-token': OPERATORDECK_TOKEN },
      body: JSON.stringify({ logs: batch }),
    });
  } catch {}
}

async function post(endpoint, body) {
  if (!OPERATORDECK_TOKEN || !OPERATORDECK_HOST) return;
  try {
    await fetch(`${OPERATORDECK_HOST}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sdk-token': OPERATORDECK_TOKEN },
      body: JSON.stringify(body),
    });
  } catch {}
}

const OperatorDeck = {
  event(eventType, payload, severity = 'info') {
    post('/api/ingest/event', { eventType, severity, payload: payload || {} });
  },
  error(eventType, payload) {
    post('/api/ingest/error', { eventType, payload: payload || {} });
  },
  log(level, message, source) {
    _logBuffer.push({ level, message: String(message), source, loggedAt: new Date().toISOString() });
    if (_logBuffer.length >= 50) _flush();
    else _scheduleFlush();
  },
  captureConsole() {
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...args) => { orig.log(...args); OperatorDeck.log('info', args.map(String).join(' '), 'console'); };
    console.warn = (...args) => { orig.warn(...args); OperatorDeck.log('warn', args.map(String).join(' '), 'console'); };
    console.error = (...args) => { orig.error(...args); OperatorDeck.log('error', args.map(String).join(' '), 'console'); };
  },
};

module.exports = { OperatorDeck };
