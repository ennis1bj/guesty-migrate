const crypto = require('crypto');

// AES-256-GCM — authenticated encryption (replaces CBC, which was malleable).
// Backward-compat: decrypt still handles old CBC ciphertexts (no "gcm:" prefix).

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_IV_LENGTH  = 12;
const CBC_IV_LENGTH  = 16;
const GCM_TAG_LENGTH = 16;

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is required');
  if (key.length === 64) return Buffer.from(key, 'hex');
  if (key.length === 32) return Buffer.from(key, 'utf8');
  throw new Error('ENCRYPTION_KEY must be 32 bytes (or 64 hex characters)');
}

function encrypt(text) {
  const key = getKey();
  const iv  = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decrypt(text) {
  if (text.startsWith('gcm:')) {
    const parts = text.slice(4).split(':');
    if (parts.length < 3) throw new Error('Invalid GCM ciphertext format');
    const iv        = Buffer.from(parts[0], 'hex');
    const tag       = Buffer.from(parts[1], 'hex');
    const encrypted = parts.slice(2).join(':');
    const decipher  = crypto.createDecipheriv(GCM_ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Legacy CBC path — supports ciphertexts encrypted before the GCM upgrade.
  const parts     = text.split(':');
  const iv        = Buffer.from(parts.shift(), 'hex');
  const encrypted = parts.join(':');
  const decipher  = crypto.createDecipheriv(CBC_ALGORITHM, getKey(), iv);
  let decrypted   = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
