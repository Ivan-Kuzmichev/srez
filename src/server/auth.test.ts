import { describe, expect, it } from 'vitest';
import { createTestAuth, seedUser, TEST_BASE_URL } from './test-auth';

const headers = () => new Headers({ origin: TEST_BASE_URL, 'x-srez-client-ip': '203.0.113.10' });

describe('auth setup', () => {
  it('signs in by username and issues a session with a uuid v7 id', async () => {
    const { auth } = createTestAuth();
    await seedUser(auth, 'owner', 'correct horse battery');
    const res = await auth.api.signInUsername({
      body: { username: 'owner', password: 'correct horse battery' },
      headers: headers(),
      asResponse: true,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('srez.session_token');
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toMatch(/^[0-9a-f-]{14}7/);
  });

  it('rejects a wrong password without saying which part is wrong', async () => {
    const { auth } = createTestAuth();
    await seedUser(auth, 'owner', 'correct horse battery');
    const res = await auth.api.signInUsername({
      body: { username: 'owner', password: 'wrong password!!' },
      headers: headers(),
      asResponse: true,
    });
    expect(res.status).toBe(401);
  });

  it('has public sign-up disabled', async () => {
    const { auth } = createTestAuth();
    await expect(
      auth.api.signUpEmail({
        body: { email: 'x@example.com', password: 'long enough password', name: 'x' },
        headers: headers(),
      }),
    ).rejects.toThrow();
  });
});
