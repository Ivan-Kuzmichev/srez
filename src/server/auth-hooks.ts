import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { loginAttempts, passkey, passkeyUsage } from '@/db/schema';
import { LOCKOUT_DURATION_MS, lockoutState, type LockoutState } from '@/domain/lockout';
import { clientIp, parseTrustedProxies } from './client-ip';
import { logger } from './logger';
import { ChallengeFailures, RateLimiter } from './rate-limit';

export const LOGIN_LOCKED = 'LOGIN_LOCKED';
export const RATE_LIMITED = 'RATE_LIMITED';

/** docs/07-auth-security.md, section 2: 20 attempts a minute per address on any sign-in endpoint. */
const SIGN_IN_PATHS = new Set([
  '/sign-in/username',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/passkey/verify-authentication',
]);

/** Better Auth allows 5 codes per challenge; the challenge cookie lives 10 minutes. */
export const TWO_FACTOR_MAX_ATTEMPTS = 5;
export const twoFactorFailures = new ChallengeFailures(10 * 60_000);

/** The 2FA challenge cookie identifies one password-verified sign-in. */
export function twoFactorChallengeKey(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'srez.two_factor' || name === '__Secure-srez.two_factor') return rest.join('=') || null;
  }
  return null;
}

export type LoginMethod = 'password' | 'password_totp' | 'password_backup' | 'passkey';

const LOGIN_METHOD_BY_PATH: Record<string, LoginMethod> = {
  '/sign-in/username': 'password',
  '/two-factor/verify-totp': 'password_totp',
  '/two-factor/verify-backup-code': 'password_backup',
  '/passkey/verify-authentication': 'passkey',
};

export function loginMethodForPath(path: string | undefined): LoginMethod | null {
  return (path && LOGIN_METHOD_BY_PATH[path]) || null;
}

export const normalizeUsername = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/** Lockout for a username from its recent attempts. A day back is far more than one lock cycle. */
export function loginLockout(db: Db, username: string, now = new Date()): LockoutState {
  const since = new Date(now.getTime() - Math.max(24 * 3600_000, LOCKOUT_DURATION_MS * 4));
  const rows = db
    .select({ success: loginAttempts.success, at: loginAttempts.createdAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.username, username), gte(loginAttempts.createdAt, since)))
    .orderBy(desc(loginAttempts.createdAt))
    .limit(200)
    .all();
  return lockoutState(rows, now);
}

/** Client address resolver bound to the configured proxies. */
export function createIpResolver(trustedProxies: string[]) {
  const trusted = parseTrustedProxies(trustedProxies.join(','));
  const hasTrusted = trustedProxies.length > 0;
  return (headers: Headers | undefined | null) =>
    clientIp(headers?.get('x-forwarded-for') ?? null, trusted, hasTrusted);
}

export function createAuthHooks(config: { db: Db; trustedProxies: string[] }) {
  const ipOf = createIpResolver(config.trustedProxies);
  const log = () => logger('auth');
  const limiter = new RateLimiter(20, 60_000);

  const before = createAuthMiddleware(async (ctx) => {
    if (!SIGN_IN_PATHS.has(ctx.path)) return;
    const ip = ipOf(ctx.headers);
    if (!limiter.hit(ip ?? 'unknown')) {
      log().warn({ ip, path: ctx.path, result: 'rate_limited' }, 'Sign-in refused: too many requests');
      throw new APIError('TOO_MANY_REQUESTS', { message: RATE_LIMITED, code: RATE_LIMITED });
    }
    if (ctx.path !== '/sign-in/username') return;
    const username = normalizeUsername((ctx.body as { username?: unknown } | undefined)?.username);
    if (!username) return;
    const state = loginLockout(config.db, username);
    if (state.locked) {
      log().warn(
        { username, method: 'password', ip: ipOf(ctx.headers), result: 'locked' },
        'Sign-in refused: locked',
      );
      throw new APIError('TOO_MANY_REQUESTS', { message: LOGIN_LOCKED, code: LOGIN_LOCKED });
    }
  });

  const after = createAuthMiddleware(async (ctx) => {
    if (ctx.path === '/sign-out') {
      log().info({ ip: ipOf(ctx.headers) }, 'Signed out');
      return;
    }
    const method = loginMethodForPath(ctx.path);
    if (!method) return;
    const returned = ctx.context.returned;
    const failed = isAPIError(returned);
    const ip = ipOf(ctx.headers);

    if (method === 'password') {
      const username = normalizeUsername((ctx.body as { username?: unknown } | undefined)?.username);
      // Locked, rate-limited or malformed requests never reached the password check.
      const checked = !failed || (returned as APIError).statusCode === 401;
      if (username && checked) {
        config.db
          .insert(loginAttempts)
          .values({ username, ip, success: !failed, createdAt: new Date() })
          .run();
      }
      const pendingSecondFactor = !failed && !ctx.context.newSession;
      if (failed) log().warn({ username, method, ip, result: 'failure' }, 'Sign-in failed');
      else
        log().info(
          { username, method, ip, result: pendingSecondFactor ? 'second_factor' : 'success' },
          'Sign-in',
        );
      return;
    }

    const username = ctx.context.newSession?.user.username ?? null;
    if (failed && method !== 'passkey') {
      const key = twoFactorChallengeKey(ctx.headers?.get('cookie'));
      if (key) twoFactorFailures.record(key);
    }
    if (failed)
      log().warn(
        { method, ip, result: 'failure', code: (returned as APIError).body?.code },
        'Sign-in failed',
      );
    else log().info({ username, method, ip, result: 'success' }, 'Sign-in');
  });

  return { before, after };
}

export const USER_VERIFICATION_REQUIRED = 'USER_VERIFICATION_REQUIRED';

/**
 * Passkey checks the plugin leaves out: it verifies responses with `requireUserVerification: false`,
 * but docs/07-auth-security.md, section 4 requires verification (fingerprint, face, PIN) every time.
 */
export function createPasskeyChecks(config: { db: Db }) {
  return {
    registration: {
      afterVerification: async ({
        verification,
      }: {
        verification: { registrationInfo?: { userVerified: boolean } };
      }) => {
        if (!verification.registrationInfo?.userVerified) {
          throw new APIError('BAD_REQUEST', {
            message: USER_VERIFICATION_REQUIRED,
            code: USER_VERIFICATION_REQUIRED,
          });
        }
      },
    },
    authentication: {
      afterVerification: async ({
        verification,
        clientData,
      }: {
        verification: { authenticationInfo: { userVerified: boolean } };
        clientData: { id: string };
      }) => {
        if (!verification.authenticationInfo.userVerified) {
          throw new APIError('UNAUTHORIZED', {
            message: USER_VERIFICATION_REQUIRED,
            code: USER_VERIFICATION_REQUIRED,
          });
        }
        const row = config.db
          .select({ id: passkey.id })
          .from(passkey)
          .where(eq(passkey.credentialID, clientData.id))
          .get();
        if (row) {
          const now = new Date();
          config.db
            .insert(passkeyUsage)
            .values({ passkeyId: row.id, lastUsedAt: now })
            .onConflictDoUpdate({ target: passkeyUsage.passkeyId, set: { lastUsedAt: now } })
            .run();
        }
      },
    },
  };
}
