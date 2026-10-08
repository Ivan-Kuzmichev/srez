import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { account, passkey, session, twoFactor, user } from '@/db/schema';
import { ru } from '@/lib/i18n/ru';
import { uuidv7 } from '@/lib/uuid';
import { PASSWORD_MIN_LENGTH, type Auth } from './auth';

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, ru.users.usernameRule);

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, ru.users.passwordTooShort(PASSWORD_MIN_LENGTH))
  .max(256);

export class UserError extends Error {
  override name = 'UserError';
}

/** Placeholder for Better Auth's mandatory email; never shown and never mailed. */
export const placeholderEmail = (username: string) => `${username}@local.invalid`;

export async function createUser(
  auth: Auth,
  db: Db,
  input: { username: string; password: string },
): Promise<string> {
  const username = UsernameSchema.parse(input.username);
  const password = PasswordSchema.parse(input.password);
  if (db.select({ id: user.id }).from(user).where(eq(user.username, username)).get()) {
    throw new UserError(ru.users.exists(username));
  }
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser(
    {
      email: placeholderEmail(username),
      name: username,
      emailVerified: true,
      username,
      displayUsername: username,
      passwordChangedAt: new Date(),
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.createAccount({
    userId: created.id,
    accountId: created.id,
    providerId: 'credential',
    password: await hashPassword(password),
  });
  return created.id;
}

export interface ResetResult {
  sessionsEnded: number;
  twoFactorDisabled: boolean;
  passkeysRemoved: number;
}

/** Sets a new password and ends every session. 2FA and passkeys stay unless asked. */
export async function resetPassword(
  db: Db,
  input: { username: string; password: string; disableTwoFactor?: boolean; removePasskeys?: boolean },
): Promise<ResetResult> {
  const username = UsernameSchema.parse(input.username);
  const password = PasswordSchema.parse(input.password);
  const found = db.select({ id: user.id }).from(user).where(eq(user.username, username)).get();
  if (!found) throw new UserError(ru.users.notFound(username));
  const hash = await hashPassword(password);

  return db.transaction((tx) => {
    const now = new Date();
    const updated = tx
      .update(account)
      .set({ password: hash, updatedAt: now })
      .where(and(eq(account.userId, found.id), eq(account.providerId, 'credential')))
      .run();
    if (updated.changes === 0) {
      tx.insert(account)
        .values({
          id: uuidv7(),
          userId: found.id,
          accountId: found.id,
          providerId: 'credential',
          password: hash,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    tx.update(user).set({ passwordChangedAt: now }).where(eq(user.id, found.id)).run();
    const sessionsEnded = tx.delete(session).where(eq(session.userId, found.id)).run().changes;

    let twoFactorDisabled = false;
    if (input.disableTwoFactor) {
      tx.delete(twoFactor).where(eq(twoFactor.userId, found.id)).run();
      tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, found.id)).run();
      twoFactorDisabled = true;
    }
    const passkeysRemoved = input.removePasskeys
      ? tx.delete(passkey).where(eq(passkey.userId, found.id)).run().changes
      : 0;
    return { sessionsEnded, twoFactorDisabled, passkeysRemoved };
  });
}
