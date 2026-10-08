'use server';

import { isAPIError } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db/client';
import { session as sessionTable, user } from '@/db/schema';
import { authedAction, type ActionResult } from '../action';
import { auth } from '../auth';
import { logger } from '../logger';
import * as security from '../security';
import { totpSecretFromUri } from '../two-factor';
import { PasswordSchema } from '../users';

const Password = z.object({ password: z.string().min(1).max(256) });
const log = () => logger('auth');

function fail(error: security.SecurityError): ActionResult<never> {
  return { ok: false, code: error };
}

// No revalidatePath here: enabling and disabling swap the session, and a re-render within this
// request would still carry the old cookie. The screen calls router.refresh() instead.

/** Step one of enabling 2FA: password check, then the QR code data. */
export const startTwoFactor = authedAction(Password, async ({ password }) => {
  const result = await security.startTwoFactorSetup(auth(), await headers(), password);
  if (!result.ok) return fail(result.error);
  return {
    ok: true,
    data: { totpURI: result.value.totpURI, secret: totpSecretFromUri(result.value.totpURI) },
  };
});

/** Step two: the first correct code turns 2FA on and returns the backup codes, shown once. */
export const confirmTwoFactor = authedAction(
  z.object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  }),
  async ({ code }, session) => {
    const result = await security.confirmTwoFactorSetup(auth(), db(), await headers(), session.user.id, code);
    if (!result.ok) return fail(result.error);
    log().info({ username: session.user.username, event: 'two_factor_enabled' }, '2FA enabled');
    return { ok: true, data: { backupCodes: result.value.backupCodes } };
  },
);

export const disableTwoFactor = authedAction(Password, async ({ password }, session) => {
  const result = await security.disableTwoFactor(auth(), db(), await headers(), session.user.id, password);
  if (!result.ok) return fail(result.error);
  log().warn({ username: session.user.username, event: 'two_factor_disabled' }, '2FA disabled');
  return { ok: true, data: null };
});

export const regenerateBackupCodes = authedAction(Password, async ({ password }, session) => {
  const result = await security.regenerateBackupCodes(auth(), await headers(), password);
  if (!result.ok) return fail(result.error);
  log().info(
    { username: session.user.username, event: 'backup_codes_regenerated' },
    'Backup codes regenerated',
  );
  return { ok: true, data: { backupCodes: result.value.backupCodes } };
});

const ChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: PasswordSchema,
    repeatPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.repeatPassword, { path: ['repeatPassword'], message: 'MISMATCH' });

/** Keeps this session, ends the others (docs/07-auth-security.md, section 5). */
export const changePassword = authedAction(ChangePasswordInput, async (input, session) => {
  try {
    await auth().api.changePassword({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (err) {
    if (isAPIError(err) && err.statusCode < 500) return { ok: false, code: 'INVALID_PASSWORD' };
    throw err;
  }
  db().update(user).set({ passwordChangedAt: new Date() }).where(eq(user.id, session.user.id)).run();
  log().warn({ username: session.user.username, event: 'password_changed' }, 'Password changed');
  return { ok: true, data: null };
});

export const revokeSession = authedAction(
  z.object({ id: z.string().min(1).max(64) }),
  async ({ id }, current) => {
    if (id === current.session.id) return { ok: false, code: 'CURRENT_SESSION' };
    const target = db()
      .select({ token: sessionTable.token })
      .from(sessionTable)
      .where(and(eq(sessionTable.id, id), eq(sessionTable.userId, current.user.id)))
      .get();
    if (!target) return { ok: false, code: 'NOT_FOUND' };
    await auth().api.revokeSession({ body: { token: target.token }, headers: await headers() });
    log().info(
      { username: current.user.username, event: 'session_revoked', sessionId: id },
      'Session revoked',
    );
    revalidatePath('/settings/security');
    return { ok: true, data: null };
  },
);

export const revokeOtherSessions = authedAction(z.object({}), async (_input, current) => {
  await auth().api.revokeOtherSessions({ headers: await headers() });
  log().info({ username: current.user.username, event: 'sessions_revoked' }, 'Other sessions revoked');
  revalidatePath('/settings/security');
  return { ok: true, data: null };
});
