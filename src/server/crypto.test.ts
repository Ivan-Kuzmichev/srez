import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptSecret, NONCE_BYTES, TAG_BYTES } from './crypto';
import { decryptSecret } from './secret-read';

const TOKEN = 't.example-broker-token-value';

describe('secrets at rest', () => {
  it('round-trips and never stores the plain value', () => {
    const blob = encryptSecret(TOKEN, 'tinvest-token');
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + NONCE_BYTES + Buffer.byteLength(TOKEN) + TAG_BYTES);
    expect(blob.toString('latin1')).not.toContain('example-broker');
    expect(decryptSecret(blob, 'tinvest-token')).toBe(TOKEN);
  });

  it('uses a fresh nonce for every value', () => {
    const a = encryptSecret(TOKEN, 'tinvest-token');
    const b = encryptSecret(TOKEN, 'tinvest-token');
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(1, 1 + NONCE_BYTES).equals(b.subarray(1, 1 + NONCE_BYTES))).toBe(false);
  });

  it('refuses a tampered value, another purpose, another key and an unknown version', () => {
    const blob = encryptSecret(TOKEN, 'tinvest-token');
    const tampered = Buffer.from(blob);
    tampered[1 + NONCE_BYTES] = tampered[1 + NONCE_BYTES]! ^ 1;
    expect(() => decryptSecret(tampered, 'tinvest-token')).toThrow(/cannot be decrypted/);
    expect(() => decryptSecret(blob, 'telegram-token')).toThrow(/cannot be decrypted/);
    expect(() => decryptSecret(blob, 'tinvest-token', randomBytes(32))).toThrow(/cannot be decrypted/);
    const future = Buffer.from(blob);
    future[0] = 2;
    expect(() => decryptSecret(future, 'tinvest-token')).toThrow(/Unknown secret format/);
    try {
      decryptSecret(tampered, 'tinvest-token');
    } catch (err) {
      expect(String(err)).not.toContain('example-broker');
    }
  });
});
