import { hashPassword } from 'better-auth/crypto';
import type { Db } from '@/db/client';
import { createTestDb } from '@/db/test-db';
import { createAuth, type Auth } from './auth';

export const TEST_BASE_URL = 'http://localhost:3000';

/** Better Auth over a fresh in-memory database. */
export function createTestAuth(): { db: Db; auth: Auth } {
  const db = createTestDb();
  const auth = createAuth({
    db,
    baseURL: TEST_BASE_URL,
    secret: 'test-secret-test-secret-test-secret-0000',
    trustedProxies: [],
  });
  return { db, auth };
}

/** Creates a user with a password the way the CLI does. */
export async function seedUser(auth: Auth, username: string, password: string): Promise<string> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    {
      email: `${username}@local.invalid`,
      name: username,
      emailVerified: true,
      username,
      displayUsername: username,
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await hashPassword(password),
  });
  return user.id;
}
