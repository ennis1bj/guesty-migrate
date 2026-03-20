const crypto = require('crypto');

// AES-256-GCM provides authenticated encryption (integrity + confidentiality)
const ALGORITHM_GCM = 'aes-256-gcm';
// Legacy CBC kept for backward-compatible decryption of existing data
const ALGORITHM_CBC = 'aes-256-cbc';
const IV_LENGTH = 16; // 16 bytes for GCM (recommended) and CBC
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag for GCM

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is required');
  // Support hex-encoded 32-byte keys (64 hex chars) or raw 32-byte strings
  if (key.length === 64) return Buffer.from(key, 'hex');
  if (key.length === 32) return Buffer.from(key, 'utf8');
  throw new Error('ENCRYPTION_KEY must be 32 bytes (or 64 hex characters)');
}

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM_GCM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: gcm:<iv>:<authTag>:<ciphertext>
  return 'gcm:' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(text) {
  if (text.startsWith('gcm:')) {
    // AES-256-GCM format: gcm:<iv>:<authTag>:<ciphertext>
    const parts = text.split(':');
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = parts.slice(3).join(':');
    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, getKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Legacy AES-256-CBC format: <iv>:<ciphertext>
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encrypted = parts.join(':');
  const decipher = crypto.createDecipheriv(ALGORITHM_CBC, getKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
