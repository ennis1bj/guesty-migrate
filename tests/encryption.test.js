/**
 * Tests for AES-256-CBC encryption/decryption module.
 */

// Set up test encryption key before requiring the module
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

const { encrypt, decrypt } = require('../server/encryption');

describe('encryption', () => {
  test('encrypts and decrypts a string round-trip', () => {
    const plaintext = 'my-secret-api-key-12345';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).toContain(':'); // IV:encrypted format
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  test('produces different ciphertexts for the same input (random IV)', () => {
    const plaintext = 'same-input';
    const ct1 = encrypt(plaintext);
    const ct2 = encrypt(plaintext);
    expect(ct1).not.toBe(ct2);
    expect(decrypt(ct1)).toBe(plaintext);
    expect(decrypt(ct2)).toBe(plaintext);
  });

  test('handles empty string', () => {
    const ct = encrypt('');
    expect(decrypt(ct)).toBe('');
  });

  test('handles unicode characters', () => {
    const text = 'héllo wörld 🔑';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  test('handles long strings', () => {
    const text = 'x'.repeat(10000);
    expect(decrypt(encrypt(text))).toBe(text);
  });

  test('decrypt throws on tampered ciphertext', () => {
    const ct = encrypt('test');
    const tampered = ct.slice(0, -2) + 'ff';
    expect(() => decrypt(tampered)).toThrow();
  });
});
