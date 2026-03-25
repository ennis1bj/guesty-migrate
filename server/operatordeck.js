const OPERATORDECK_HOST = process.env.OPERATORDECK_HOST || '';
const OPERATORDECK_TOKEN = process.env.OPERATORDECK_TOKEN || '';

async function post(endpoint, body) {
  if (!OPERATORDECK_TOKEN || !OPERATORDECK_HOST) return;
  try {
    await fetch(`${OPERATORDECK_HOST}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sdk-token': OPERATORDECK_TOKEN,
      },
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
};

module.exports = { OperatorDeck };
