import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { passkey, session, twoFactor, user } from '@/db/schema';
import { createTestAuth, TEST_BASE_URL } from './test-auth';
import { createUser, resetPassword, UserError } from './users';

const headers = () => new Headers({ origin: TEST_BASE_URL, 'x-forwarded-for': '203.0.113.10' });
const PASSWORD = 'first password 1';

async function signIn(auth: ReturnType<typeof createTestAuth>['auth'], username: string, password: string) {
  return auth.api.signInUsername({ body: { username, password }, headers: headers(), asResponse: true });
}

describe('createUser', () => {
  it('creates a user who can sign in, with a normalized username', async () => {
    const { auth, db } = createTestAuth();
    await createUser(auth, db, { username: ' Owner ', password: PASSWORD });
    expect((await signIn(auth, 'owner', PASSWORD)).status).toBe(200);
    const row = db.select().from(user).get()!;
    expect(row.email).toBe('owner@local.invalid');
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('rejects short passwords, bad usernames and duplicates', async () => {
    const { auth, db } = createTestAuth();
    await expect(createUser(auth, db, { username: 'owner', password: 'short' })).rejects.toThrow();
    await expect(createUser(auth, db, { username: 'a b', password: PASSWORD })).rejects.toThrow();
    await createUser(auth, db, { username: 'owner', password: PASSWORD });
    await expect(createUser(auth, db, { username: 'owner', password: PASSWORD })).rejects.toThrow(UserError);
  });
});

describe('resetPassword', () => {
  it('changes the password and ends all sessions, keeping 2FA and passkeys by default', async () => {
    const { auth, db } = createTestAuth();
    const id = await createUser(auth, db, { username: 'owner', password: PASSWORD });
    await signIn(auth, 'owner', PASSWORD);
    db.insert(twoFactor).values({ id: 't1', userId: id, secret: 's', backupCodes: 'b' }).run();
    db.insert(passkey)
      .values({
        id: 'p1',
        userId: id,
        publicKey: 'k',
        credentialID: 'c',
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .run();

    const result = await resetPassword(db, { username: 'owner', password: 'second password 2' });
    expect(result).toEqual({ sessionsEnded: 1, twoFactorDisabled: false, passkeysRemoved: 0 });
    expect(db.select().from(session).all()).toHaveLength(0);
    expect((await signIn(auth, 'owner', PASSWORD)).status).toBe(401);
    expect((await signIn(auth, 'owner', 'second password 2')).status).toBe(200);
    expect(db.select().from(twoFactor).all()).toHaveLength(1);
    expect(db.select().from(passkey).all()).toHaveLength(1);
  });

  it('can also disable 2FA and remove passkeys', async () => {
    const { auth, db } = createTestAuth();
    const id = await createUser(auth, db, { username: 'owner', password: PASSWORD });
    db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, id)).run();
    db.insert(twoFactor).values({ id: 't1', userId: id, secret: 's', backupCodes: 'b' }).run();
    db.insert(passkey)
      .values({
        id: 'p1',
        userId: id,
        publicKey: 'k',
        credentialID: 'c',
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .run();
    const result = await resetPassword(db, {
      username: 'owner',
      password: 'second password 2',
      disableTwoFactor: true,
      removePasskeys: true,
    });
    expect(result).toMatchObject({ twoFactorDisabled: true, passkeysRemoved: 1 });
    expect(db.select().from(user).get()!.twoFactorEnabled).toBe(false);
  });

  it('fails for an unknown user', async () => {
    const { db } = createTestAuth();
    await expect(resetPassword(db, { username: 'ghost', password: PASSWORD })).rejects.toThrow(UserError);
  });
});
