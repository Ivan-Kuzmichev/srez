import { randomInt } from 'node:crypto';

/** Unambiguous characters: no 0/O, 1/I/L. */
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BACKUP_CODES_COUNT = 10;

/** «4F7K-92QD»: eight characters in two groups, easy to read off paper. */
export function generateBackupCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODES_COUNT }, generateBackupCode);
}

/** Accepts «4f7k 92qd», «4F7K92QD», «4F7K-92QD» alike. */
export function normalizeBackupCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

/** The base32 secret from an otpauth:// URI, grouped by four for typing by hand. */
export function totpSecretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  return secret.replace(/(.{4})/g, '$1 ').trim();
}
