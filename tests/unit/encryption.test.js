const { encrypt, decrypt } = require('../../server/encryption');

describe('encrypt / decrypt', () => {
  test('decrypt(encrypt(x)) === x for a simple string', () => {
    const plaintext = 'hello world';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test('decrypt(encrypt(x)) === x for API credentials', () => {
    const secret = 'abc123-client-secret-xyz789';
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  test('encrypt produces a hex-prefixed colon-delimited string', () => {
    const token = encrypt('test');
    expect(token).toMatch(/^[0-9a-f]{32}:/);
  });

  test('two encryptions of the same plaintext produce different ciphertexts (random IV)', () => {
    const plaintext = 'same value';
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  test('encrypts empty string without throwing', () => {
    expect(() => decrypt(encrypt(''))).not.toThrow();
  });

  test('encrypt and decrypt handle special characters and unicode', () => {
    const value = 'my-sécret 🔑 & <special>!';
    expect(decrypt(encrypt(value))).toBe(value);
  });

  test('decrypt throws on a tampered ciphertext', () => {
    const encrypted = encrypt('valid data');
    const tampered = encrypted.slice(0, -4) + 'XXXX';
    expect(() => decrypt(tampered)).toThrow();
  });
});
