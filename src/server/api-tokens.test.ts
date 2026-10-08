import { describe, expect, it } from 'vitest';
import { apiTokens, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import {
  activeToken,
  checkToken,
  generateToken,
  hashToken,
  issueToken,
  reissueToken,
  revokeToken,
  updateTokenSettings,
} from './api-tokens';

const now = new Date('2026-10-08T12:00:00Z');
const settings = {
  name: 'Claude, диагностика',
  ttl: '30d' as const,
  scopes: ['read:data' as const, 'read:logs' as const],
  localOnly: true,
};

function setup() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  return db;
}
const bearer = (t: string) => `Bearer ${t}`;

describe('API tokens (07, sections 8 and 10)', () => {
  it('look like inv_ and 32 random bytes in base62; only the hash and the last four are stored', () => {
    const t = generateToken();
    expect(t).toMatch(/^inv_[0-9A-Za-z]{43}$/);
    expect(generateToken()).not.toBe(t);
    const db = setup();
    const { token, row } = issueToken(db, 'u1', settings, now);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.last4).toBe(token.slice(-4));
    expect(JSON.stringify(db.select().from(apiTokens).all())).not.toContain(token);
    expect(row.expiresAt).toEqual(new Date(now.getTime() + 30 * 86_400_000));
  });

  it('accept a good call from the local network and record its use', () => {
    const db = setup();
    const { token } = issueToken(db, 'u1', settings, now);
    const r = checkToken(db, bearer(token), '192.168.1.5', '/api/v1/sync/status', now);
    expect(r.ok).toBe(true);
    expect(activeToken(db, 'u1')).toMatchObject({
      lastUsedIp: '192.168.1.5',
      lastUsedPath: '/api/v1/sync/status',
      lastUsedAt: now,
    });
  });

  it('refuse a local-only token from outside and when the address is unknown (a forged header gives none)', () => {
    const db = setup();
    const { token } = issueToken(db, 'u1', settings, now);
    expect(checkToken(db, bearer(token), '203.0.113.7', '/api/v1/health', now)).toMatchObject({
      ok: false,
      status: 403,
      code: 'NETWORK',
    });
    expect(checkToken(db, bearer(token), null, '/api/v1/health', now)).toMatchObject({
      ok: false,
      status: 403,
    });
    updateTokenSettings(db, 'u1', { ...settings, localOnly: false });
    expect(checkToken(db, bearer(token), '203.0.113.7', '/api/v1/health', now).ok).toBe(true);
  });

  it('give 401 to revoked, expired, replaced, unknown and malformed tokens', () => {
    const db = setup();
    const { token: day } = issueToken(db, 'u1', { ...settings, ttl: '24h' }, now);
    const later = new Date(now.getTime() + 86_400_001);
    expect(checkToken(db, bearer(day), '127.0.0.1', '/x', later)).toMatchObject({ ok: false, status: 401 });

    const { token: first } = issueToken(db, 'u1', { ...settings, ttl: 'never' }, now);
    expect(checkToken(db, bearer(first), '127.0.0.1', '/x', later).ok).toBe(true);
    const second = reissueToken(db, 'u1', 'never', now)!;
    expect(checkToken(db, bearer(first), '127.0.0.1', '/x', now)).toMatchObject({ status: 401 });
    expect(checkToken(db, bearer(second.token), '127.0.0.1', '/x', now).ok).toBe(true);
    expect(second.row.name).toBe('Claude, диагностика');

    expect(revokeToken(db, 'u1', now)).toBe(true);
    expect(checkToken(db, bearer(second.token), '127.0.0.1', '/x', now)).toMatchObject({ status: 401 });
    expect(activeToken(db, 'u1')).toBeNull();
    expect(checkToken(db, bearer(generateToken()), '127.0.0.1', '/x', now)).toMatchObject({ status: 401 });
    expect(checkToken(db, 'Bearer nope', '127.0.0.1', '/x', now)).toMatchObject({ status: 401 });
    expect(checkToken(db, null, '127.0.0.1', '/x', now)).toMatchObject({ status: 401 });
  });
});
