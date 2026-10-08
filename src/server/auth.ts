import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor, username } from 'better-auth/plugins';
import { db, type Db } from '@/db/client';
import * as schema from '@/db/schema';
import { APP_NAME } from '@/lib/app';
import { uuidv7 } from '@/lib/uuid';
import { createAuthHooks, loginMethodForPath } from './auth-hooks';
import { authSecret, env, trustedProxyList } from './env';
import { BACKUP_CODES_COUNT, generateBackupCodes } from './two-factor';

export const PASSWORD_MIN_LENGTH = 12;
export const SESSION_TTL_REMEMBER_S = 30 * 24 * 3600;

export interface AuthConfig {
  db: Db;
  /** Public address, e.g. https://invest.home.arpa. Cookies and passkeys are bound to it. */
  baseURL: string;
  secret: string;
  trustedProxies: string[];
}

export function createAuth(config: AuthConfig) {
  const url = new URL(config.baseURL);
  return betterAuth({
    appName: APP_NAME,
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [url.origin],
    database: drizzleAdapter(config.db, { provider: 'sqlite', schema }),
    hooks: createAuthHooks({ db: config.db, trustedProxies: config.trustedProxies }),
    databaseHooks: {
      session: {
        create: {
          // How the session was obtained, for the sessions table in settings.
          before: async (session, ctx) => ({
            data: { ...session, loginMethod: loginMethodForPath(ctx?.path) },
          }),
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 256,
    },
    user: {
      additionalFields: {
        passwordChangedAt: { type: 'date', required: false, input: false },
        twoFactorEnabledAt: { type: 'date', required: false, input: false },
      },
    },
    session: {
      // «Запомнить устройство»: 30 days, sliding. Without it Better Auth issues a browser-session cookie capped at 24 h.
      expiresIn: SESSION_TTL_REMEMBER_S,
      updateAge: 24 * 3600,
      additionalFields: {
        loginMethod: { type: 'string', required: false, input: false },
      },
    },
    advanced: {
      cookiePrefix: 'srez',
      useSecureCookies: url.protocol === 'https:',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: config.trustedProxies },
      database: { generateId: () => uuidv7() },
    },
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/*': { window: 60, max: 20 },
        '/two-factor/*': { window: 60, max: 20 },
        '/passkey/verify-authentication': { window: 60, max: 20 },
      },
    },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 32 }),
      twoFactor({
        issuer: APP_NAME,
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: {
          amount: BACKUP_CODES_COUNT,
          storeBackupCodes: 'encrypted',
          customBackupCodesGenerate: generateBackupCodes,
        },
        trustDeviceMaxAge: SESSION_TTL_REMEMBER_S,
      }),
      passkey({
        rpID: url.hostname,
        rpName: APP_NAME,
        origin: url.origin,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { srezAuth?: Auth };

/** Process-wide instance. Created on first use so that `next build` does not need secrets. */
export function auth(): Auth {
  globalForAuth.srezAuth ??= createAuth({
    db: db(),
    baseURL: env().APP_URL,
    secret: authSecret(),
    trustedProxies: trustedProxyList(),
  });
  return globalForAuth.srezAuth;
}
