import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { loginAttempts, logs, session } from '@/db/schema';
import { LOCKOUT_DURATION_MS } from '@/domain/lockout';
import { createLogger } from './logger';
import { createTestAuth, seedUser, TEST_BASE_URL } from './test-auth';

const PASSWORD = 'correct horse battery';
const headers = () => new Headers({ origin: TEST_BASE_URL, 'x-srez-client-ip': '203.0.113.10' });

function setup() {
  const t = createTestAuth();
  // Route the auth logger into the same test database.
  const { root, sink } = createLogger({
    level: 'info',
    getDb: () => t.db,
    console: new Writable({ write: (_c, _e, cb) => cb() }),
  });
  globalThis.srezLoggerForTests = { root, sink };
  return { ...t, sink };
}

declare global {
  var srezLoggerForTests: unknown;
}

vi.mock('./logger', async (orig) => {
  const actual = await orig<typeof import('./logger')>();
  return {
    ...actual,
    logger: (source: string, bindings: Record<string, unknown> = {}) =>
      (globalThis.srezLoggerForTests as { root: import('pino').Logger }).root.child({ source, ...bindings }),
  };
});

const signIn = (auth: ReturnType<typeof setup>['auth'], password: string, username = 'owner') =>
  auth.api.signInUsername({ body: { username, password }, headers: headers(), asResponse: true });

describe('password lockout', () => {
  it('locks on the fifth failure, refuses even the right password, and unlocks after 15 minutes', async () => {
    const { auth, db } = setup();
    await seedUser(auth, 'owner', PASSWORD);
    for (let i = 0; i < 4; i++) expect((await signIn(auth, 'wrong password!!')).status).toBe(401);
    expect((await signIn(auth, 'wrong password!!')).status).toBe(401); // fifth failure locks

    // A before-hook error is thrown to direct callers (the route handler turns it into a 429).
    await expect(signIn(auth, PASSWORD)).rejects.toMatchObject({
      statusCode: 429,
      body: { code: 'LOGIN_LOCKED' },
    });

    // Move every attempt 15 minutes into the past.
    const rows = db.select().from(loginAttempts).all();
    expect(rows).toHaveLength(5);
    db.delete(loginAttempts).run();
    db.insert(loginAttempts)
      .values(
        rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt.getTime() - LOCKOUT_DURATION_MS - 1000) })),
      )
      .run();
    expect((await signIn(auth, PASSWORD)).status).toBe(200);
  });

  it('a successful sign-in resets the counter', async () => {
    const { auth, db } = setup();
    await seedUser(auth, 'owner', PASSWORD);
    for (let i = 0; i < 4; i++) await signIn(auth, 'wrong password!!');
    expect((await signIn(auth, PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) await signIn(auth, 'wrong password!!');
    expect((await signIn(auth, PASSWORD)).status).toBe(200);
    expect(db.select().from(loginAttempts).all()).toHaveLength(10);
  });

  it('counts attempts for unknown usernames too, without revealing anything', async () => {
    const { auth, db } = setup();
    expect((await signIn(auth, 'whatever pass!', 'ghost')).status).toBe(401);
    expect(db.select().from(loginAttempts).get()).toMatchObject({
      username: 'ghost',
      success: false,
      ip: '203.0.113.10',
    });
  });
});

describe('session address', () => {
  it('keeps a full IPv6 address instead of the /64 subnet', async () => {
    const { auth, db } = setup();
    await seedUser(auth, 'owner', PASSWORD);
    await auth.api.signInUsername({
      body: { username: 'owner', password: PASSWORD },
      headers: new Headers({ origin: TEST_BASE_URL, 'x-srez-client-ip': '2001:db8::1234' }),
    });
    expect(db.select().from(session).get()?.ipAddress).toBe('2001:db8::1234');
  });
});

describe('sign-in events', () => {
  it('logs successes and failures under source auth without the password', async () => {
    const { auth, db, sink } = setup();
    await seedUser(auth, 'owner', PASSWORD);
    await signIn(auth, 'wrong password!!');
    await signIn(auth, PASSWORD);
    sink.flush();
    const rows = db.select().from(logs).all();
    expect(rows.map((r) => [r.level, r.message, r.context?.result])).toEqual([
      ['warn', 'Sign-in failed', 'failure'],
      ['info', 'Sign-in', 'success'],
    ]);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('wrong password');
    expect(rows[1]!.context).toMatchObject({ username: 'owner', method: 'password', ip: '203.0.113.10' });
  });

  it('stores the login method and the client address on the session', async () => {
    const { auth, db } = setup();
    await seedUser(auth, 'owner', PASSWORD);
    await signIn(auth, PASSWORD);
    expect(db.select().from(session).get()).toMatchObject({
      loginMethod: 'password',
      ipAddress: '203.0.113.10',
    });
  });
});
