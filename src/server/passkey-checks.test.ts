import { describe, expect, it } from 'vitest';
import { passkey, passkeyUsage, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { createPasskeyChecks, USER_VERIFICATION_REQUIRED } from './auth-hooks';

function setup() {
  const db = createTestDb();
  const now = new Date();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  db.insert(passkey)
    .values({
      id: 'p1',
      userId: 'u1',
      publicKey: 'k',
      credentialID: 'cred-1',
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    })
    .run();
  return { db, checks: createPasskeyChecks({ db }) };
}

describe('passkey checks', () => {
  it('refuse registration and sign-in without user verification', async () => {
    const { checks } = setup();
    await expect(
      checks.registration.afterVerification({ verification: { registrationInfo: { userVerified: false } } }),
    ).rejects.toMatchObject({ body: { code: USER_VERIFICATION_REQUIRED } });
    await expect(
      checks.authentication.afterVerification({
        verification: { authenticationInfo: { userVerified: false } },
        clientData: { id: 'cred-1' },
      }),
    ).rejects.toMatchObject({ body: { code: USER_VERIFICATION_REQUIRED } });
  });

  it('record the last sign-in per passkey', async () => {
    const { db, checks } = setup();
    const ok = { verification: { authenticationInfo: { userVerified: true } }, clientData: { id: 'cred-1' } };
    await checks.authentication.afterVerification(ok);
    const first = db.select().from(passkeyUsage).get()!.lastUsedAt;
    await new Promise((r) => setTimeout(r, 5));
    await checks.authentication.afterVerification(ok);
    expect(db.select().from(passkeyUsage).all()).toHaveLength(1);
    expect(db.select().from(passkeyUsage).get()!.lastUsedAt.getTime()).toBeGreaterThan(first.getTime());
  });
});
