import { createDecipheriv } from 'node:crypto';
import { NONCE_BYTES, SECRET_VERSION, secretKey, TAG_BYTES, type SecretPurpose } from './crypto';

/**
 * The only way back to a plain secret. Imported by the worker alone (an ESLint rule keeps it out of
 * pages, actions and components), right before a call to the external API.
 */
export function decryptSecret(blob: Uint8Array, purpose: SecretPurpose, key = secretKey()): string {
  const data = Buffer.from(blob);
  if (data.length < 1 + NONCE_BYTES + TAG_BYTES || data[0] !== SECRET_VERSION)
    throw new Error('Unknown secret format');
  const nonce = data.subarray(1, 1 + NONCE_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(purpose, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(data.subarray(1 + NONCE_BYTES, data.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Never echo anything of the value; a wrong APP_SECRET_KEY lands here too.
    throw new Error('Secret cannot be decrypted: APP_SECRET_KEY changed or the value is damaged');
  }
}
