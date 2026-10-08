'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db/client';
import { authedAction, type ActionResult } from '../action';
import { auth } from '../auth';
import { logger } from '../logger';
import * as security from '../security';
import { totpSecretFromUri } from '../two-factor';

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
