import { describe, expect, it } from 'vitest';
import { totpFromUri } from '../../tests/helpers/totp';
import {
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateBackupCodes,
  startTwoFactorSetup,
  twoFactorStatus,
} from './security';
import { createTestAuth, seedUser, TEST_BASE_URL } from './test-auth';

const PASSWORD = 'correct horse battery';
const base = { origin: TEST_BASE_URL, 'x-forwarded-for': '203.0.113.10' };

function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function signedIn() {
  const t = createTestAuth();
  const userId = await seedUser(t.auth, 'owner', PASSWORD);
  const res = await t.auth.api.signInUsername({
    body: { username: 'owner', password: PASSWORD },
    headers: new Headers(base),
    asResponse: true,
  });
  return { ...t, userId, headers: new Headers({ ...base, cookie: cookieFrom(res) }) };
}

async function enable(t: Awaited<ReturnType<typeof signedIn>>) {
  const started = await startTwoFactorSetup(t.auth, t.headers, PASSWORD);
  if (!started.ok) throw new Error(started.error);
  const confirmed = await confirmTwoFactorSetup(
    t.auth,
    t.db,
    t.headers,
    t.userId,
    totpFromUri(started.value.totpURI),
  );
  if (!confirmed.ok) throw new Error(confirmed.error);
  // Enabling replaces the session; continue with the new cookie.
  t.headers.set('cookie', confirmed.value.setCookie.map((c) => c.split(';')[0]).join('; '));
  return { uri: started.value.totpURI, codes: confirmed.value.backupCodes };
}

/** Password step, then the second factor; returns the HTTP status of the second step. */
async function signInWithSecondFactor(
  t: Awaited<ReturnType<typeof signedIn>>,
  second: { totp?: string; backup?: string },
) {
  const first = await t.auth.api.signInUsername({
    body: { username: 'owner', password: PASSWORD },
    headers: new Headers(base),
    asResponse: true,
  });
  expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
  const headers = new Headers({ ...base, cookie: cookieFrom(first) });
  const res = second.totp
    ? await t.auth.api.verifyTOTP({ body: { code: second.totp }, headers, asResponse: true })
    : await t.auth.api.verifyBackupCode({ body: { code: second.backup! }, headers, asResponse: true });
  return res.status;
}

describe('two-factor setup', () => {
  it('needs the password, stays off until a correct code, then gives ten backup codes', async () => {
    const t = await signedIn();
    expect(await startTwoFactorSetup(t.auth, t.headers, 'wrong password')).toEqual({
      ok: false,
      error: 'INVALID_PASSWORD',
    });

    const started = await startTwoFactorSetup(t.auth, t.headers, PASSWORD);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect((await twoFactorStatus(t.auth, t.db, t.userId)).enabled).toBe(false);
    expect(await confirmTwoFactorSetup(t.auth, t.db, t.headers, t.userId, '000000')).toMatchObject({
      ok: false,
    });

    const confirmed = await confirmTwoFactorSetup(
      t.auth,
      t.db,
      t.headers,
      t.userId,
      totpFromUri(started.value.totpURI),
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.backupCodes).toHaveLength(10);
    expect(confirmed.value.backupCodes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(await twoFactorStatus(t.auth, t.db, t.userId)).toMatchObject({
      enabled: true,
      backupCodesLeft: 10,
    });
  });
});

describe('sign-in with 2FA', () => {
  it('asks for a code after the password and accepts a valid one', async () => {
    const t = await signedIn();
    const { uri } = await enable(t);
    expect(await signInWithSecondFactor(t, { totp: totpFromUri(uri) })).toBe(200);
  });

  it('a backup code works once only', async () => {
    const t = await signedIn();
    const { codes } = await enable(t);
    expect(await signInWithSecondFactor(t, { backup: codes[0] })).toBe(200);
    expect(await signInWithSecondFactor(t, { backup: codes[0] })).not.toBe(200);
    expect((await twoFactorStatus(t.auth, t.db, t.userId)).backupCodesLeft).toBe(9);
  });

  it('new backup codes replace the old ones', async () => {
    const t = await signedIn();
    const { codes } = await enable(t);
    const fresh = await regenerateBackupCodes(t.auth, t.headers, PASSWORD);
    expect(fresh.ok).toBe(true);
    expect(await signInWithSecondFactor(t, { backup: codes[1] })).not.toBe(200);
    if (fresh.ok) expect(await signInWithSecondFactor(t, { backup: fresh.value.backupCodes[0] })).toBe(200);
  });

  it('disabling needs the password and turns the code step off', async () => {
    const t = await signedIn();
    await enable(t);
    expect(await disableTwoFactor(t.auth, t.db, t.headers, t.userId, 'wrong password')).toEqual({
      ok: false,
      error: 'INVALID_PASSWORD',
    });
    expect((await disableTwoFactor(t.auth, t.db, t.headers, t.userId, PASSWORD)).ok).toBe(true);
    const res = await t.auth.api.signInUsername({
      body: { username: 'owner', password: PASSWORD },
      headers: new Headers(base),
      asResponse: true,
    });
    expect(await res.json()).not.toHaveProperty('twoFactorRedirect');
  });
});
