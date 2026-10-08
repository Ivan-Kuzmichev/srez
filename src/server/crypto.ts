import { createCipheriv, randomBytes } from 'node:crypto';
import { env } from './env';

/**
 * Secrets at rest (docs/07-auth-security.md, section 7): AES-256-GCM with a random nonce per value,
 * stored as `version | nonce | ciphertext | tag`. The purpose ("tinvest-token") is authenticated data,
 * so a value cannot be moved into another field. Decryption lives in `secret-read.ts`, worker only.
 */
export const SECRET_VERSION = 1;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

export type SecretPurpose = 'tinvest-token' | 'telegram-token' | 'coingecko-key';

// Fixed key for development and tests only; production refuses to start without APP_SECRET_KEY.
const DEV_KEY = Buffer.alloc(32, 'srez-development-key-do-not-use');

export function secretKey(): Buffer {
  const { APP_SECRET_KEY, NODE_ENV } = env();
  if (!APP_SECRET_KEY) {
    if (NODE_ENV === 'production')
      throw new Error('APP_SECRET_KEY is not set. Generate one: openssl rand -base64 32');
    return DEV_KEY;
  }
  const key = Buffer.from(APP_SECRET_KEY, 'base64');
  if (key.length !== 32)
    throw new Error('APP_SECRET_KEY must be 32 bytes in base64 (openssl rand -base64 32)');
  return key;
}

export function encryptSecret(plain: string, purpose: SecretPurpose, key = secretKey()): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(purpose, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([SECRET_VERSION]), nonce, body, cipher.getAuthTag()]);
}
