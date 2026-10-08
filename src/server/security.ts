import { isAPIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { twoFactor, user } from '@/db/schema';
import type { Auth } from './auth';
import { normalizeBackupCode } from './two-factor';

/**
 * 2FA management on top of Better Auth, shared by server actions and tests.
 * Every call takes the request headers so Better Auth sees the caller's session.
 */
export type SecurityError = 'INVALID_PASSWORD' | 'INVALID_CODE' | 'ALREADY_ENABLED';

function errorCode(err: unknown): SecurityError | null {
  if (!isAPIError(err)) return null;
  const code = (err.body as { code?: string } | undefined)?.code;
  if (code === 'INVALID_PASSWORD') return 'INVALID_PASSWORD';
  if (code === 'TOTP_ALREADY_ENABLED') return 'ALREADY_ENABLED';
  if (code === 'INVALID_CODE' || code === 'INVALID_TWO_FACTOR_COOKIE') return 'INVALID_CODE';
  return null;
}

async function guard<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: SecurityError }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const error = errorCode(err);
    if (!error) throw err;
    return { ok: false, error };
  }
}

/** Step one: checks the password and returns the otpauth URI for the QR code. 2FA is not on yet. */
export function startTwoFactorSetup(auth: Auth, headers: Headers, password: string) {
  return guard(async () => {
    const result = await auth.api.enableTwoFactor({ body: { password }, headers });
    if (result.method !== 'totp') throw new Error('Expected TOTP setup');
    return { totpURI: result.totpURI };
  });
}

/** Step two: a correct code turns 2FA on. Returns the backup codes to show once. */
export function confirmTwoFactorSetup(auth: Auth, db: Db, headers: Headers, userId: string, code: string) {
  return guard(async () => {
    // Better Auth replaces the session here; the new cookie reaches the browser via nextCookies.
    const { headers: responseHeaders } = await auth.api.verifyTOTP({
      body: { code },
      headers,
      returnHeaders: true,
    });
    db.update(user).set({ twoFactorEnabledAt: new Date() }).where(eq(user.id, userId)).run();
    const codes = await auth.api.viewBackupCodes({ body: { userId } });
    return { backupCodes: codes.backupCodes, setCookie: responseHeaders.getSetCookie() };
  });
}

/** Request headers with the cookies a previous call just set, for a follow-up call in the same request. */
export function withSetCookies(headers: Headers, setCookie: string[]): Headers {
  const jar = new Map<string, string>();
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) jar.set(name, rest.join('='));
  }
  for (const line of setCookie) {
    const [pair = ''] = line.split(';');
    const [name, ...rest] = pair.trim().split('=');
    if (name) jar.set(name, rest.join('='));
  }
  const next = new Headers(headers);
  next.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  return next;
}

/** Turns 2FA off (password required) and ends the other sessions. */
export function disableTwoFactor(auth: Auth, db: Db, headers: Headers, userId: string, password: string) {
  return guard(async () => {
    // Better Auth swaps the session while disabling; the revoke below must use the new one.
    const { headers: responseHeaders } = await auth.api.disableTwoFactor({
      body: { password },
      headers,
      returnHeaders: true,
    });
    db.update(user).set({ twoFactorEnabledAt: null }).where(eq(user.id, userId)).run();
    await auth.api.revokeOtherSessions({ headers: withSetCookies(headers, responseHeaders.getSetCookie()) });
    return null;
  });
}

/** New set of backup codes; the old ones stop working. */
export function regenerateBackupCodes(auth: Auth, headers: Headers, password: string) {
  return guard(async () => {
    const result = await auth.api.generateBackupCodes({ body: { password }, headers });
    return { backupCodes: result.backupCodes };
  });
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: Date | null;
  backupCodesLeft: number;
}

export async function twoFactorStatus(auth: Auth, db: Db, userId: string): Promise<TwoFactorStatus> {
  const row = db
    .select({ enabled: user.twoFactorEnabled, enabledAt: user.twoFactorEnabledAt })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  const enabled = Boolean(row?.enabled);
  const hasRow =
    enabled && db.select({ id: twoFactor.id }).from(twoFactor).where(eq(twoFactor.userId, userId)).get();
  const backupCodesLeft = hasRow
    ? (await auth.api.viewBackupCodes({ body: { userId } })).backupCodes.length
    : 0;
  return { enabled, enabledAt: row?.enabledAt ?? null, backupCodesLeft };
}

export { normalizeBackupCode };
