import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { apiTokens, type ApiScope } from '@/db/schema';
import { isLocalAddress } from './client-ip';

/** docs/07-auth-security.md, section 8. */
export const TOKEN_TTLS = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  never: null,
} as const;
export type TokenTtl = keyof typeof TOKEN_TTLS;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base62(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(43, '0');
}

/** «inv_» + 32 random bytes in base62. */
export function generateToken(): string {
  return `inv_${base62(randomBytes(32))}`;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export type ApiTokenRow = typeof apiTokens.$inferSelect;

export interface TokenSettings {
  name: string;
  ttl: TokenTtl;
  scopes: ApiScope[];
  localOnly: boolean;
}

/** The user's token in use (one per user, as in the DevSettings mockup), or null. */
export function activeToken(db: Executor, userId: string): ApiTokenRow | null {
  return (
    db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt))
      .get() ?? null
  );
}

/**
 * A new token; the previous one stops working at once. Returns the plain token: it is shown once
 * and never stored.
 */
export function issueToken(
  db: Executor,
  userId: string,
  s: TokenSettings,
  now = new Date(),
): { token: string; row: ApiTokenRow } {
  const token = generateToken();
  const ttl = TOKEN_TTLS[s.ttl];
  const row = db.transaction((tx) => {
    tx.update(apiTokens)
      .set({ revokedAt: now })
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
      .run();
    return tx
      .insert(apiTokens)
      .values({
        userId,
        name: s.name,
        tokenHash: hashToken(token),
        last4: token.slice(-4),
        scopes: s.scopes,
        localOnly: s.localOnly,
        expiresAt: ttl === null ? null : new Date(now.getTime() + ttl),
        createdAt: now,
      })
      .returning()
      .get();
  });
  return { token, row };
}

/** «Перевыпустить»: same name, rights and network limit, a new value and a fresh term. */
export function reissueToken(
  db: Executor,
  userId: string,
  ttl: TokenTtl,
  now = new Date(),
): { token: string; row: ApiTokenRow } | null {
  const current = activeToken(db, userId);
  if (!current) return null;
  return issueToken(
    db,
    userId,
    { name: current.name, ttl, scopes: current.scopes, localOnly: current.localOnly },
    now,
  );
}

export function revokeToken(db: Executor, userId: string, now = new Date()): boolean {
  return (
    db
      .update(apiTokens)
      .set({ revokedAt: now })
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
      .run().changes > 0
  );
}

/** Name, rights and the network limit change in place; the token value stays. */
export function updateTokenSettings(db: Executor, userId: string, s: Omit<TokenSettings, 'ttl'>): boolean {
  const current = activeToken(db, userId);
  if (!current) return false;
  db.update(apiTokens)
    .set({ name: s.name, scopes: s.scopes, localOnly: s.localOnly })
    .where(eq(apiTokens.id, current.id))
    .run();
  return true;
}

export type TokenCheck =
  | { ok: true; token: ApiTokenRow }
  | { ok: false; status: 401 | 403; code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NETWORK'; message: string };

/**
 * The Authorization header of an API call (docs/06-api.md, sections 1–3, 6): unknown, revoked and
 * expired tokens get 401; a local-only token from outside, 403. A good call updates the usage fields.
 */
export function checkToken(
  db: Executor,
  authorization: string | null,
  ip: string | null,
  path: string,
  now = new Date(),
): TokenCheck {
  const match = /^Bearer\s+(inv_[0-9A-Za-z]{20,})\s*$/.exec(authorization ?? '');
  if (!match) return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing or malformed token' };
  const row = db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(match[1]!)))
    .get();
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now))
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Token is unknown, revoked or expired' };
  if (row.localOnly && !isLocalAddress(ip))
    return {
      ok: false,
      status: 403,
      code: 'NETWORK',
      message: 'This token works from the local network only',
    };
  db.update(apiTokens)
    .set({ lastUsedAt: now, lastUsedIp: ip, lastUsedPath: path })
    .where(eq(apiTokens.id, row.id))
    .run();
  return { ok: true, token: row };
}
