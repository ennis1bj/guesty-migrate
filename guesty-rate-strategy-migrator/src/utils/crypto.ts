import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const key = process.env.PAYLOAD_ENCRYPTION_KEY;
  if (!key) throw new Error('PAYLOAD_ENCRYPTION_KEY environment variable is required');
  if (key.length === 64) return Buffer.from(key, 'hex');
  if (key.length === 32) return Buffer.from(key, 'utf8');
  throw new Error('PAYLOAD_ENCRYPTION_KEY must be 32 bytes (raw) or 64 hex characters');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: gcm:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a ciphertext produced by encrypt().
 * Throws if the payload is tampered or the key is wrong (GCM auth tag check).
 */
export function decrypt(text: string): string {
  if (!text.startsWith('gcm:')) {
    throw new Error('Invalid encrypted payload — expected gcm: prefix');
  }
  const parts = text.split(':');
  if (parts.length < 4) {
    throw new Error('Malformed encrypted payload');
  }
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const encrypted = parts.slice(3).join(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
