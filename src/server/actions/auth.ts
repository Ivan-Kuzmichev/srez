'use server';

import { isAPIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { authedAction, publicAction, type ActionResult } from '../action';
import { auth } from '../auth';
import {
  LOGIN_LOCKED,
  loginLockout,
  normalizeUsername,
  RATE_LIMITED,
  TWO_FACTOR_MAX_ATTEMPTS,
  twoFactorChallengeKey,
  twoFactorFailures,
} from '../auth-hooks';
import { safeNext } from '../session';

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

const SignInInput = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  remember: checkbox.optional().default(false),
  next: z.string().optional(),
});

type Fail = Extract<ActionResult, { ok: false }>;

function lockedResult(username: string): Fail {
  const state = loginLockout(db(), username);
  return {
    ok: false,
    code: 'LOCKED',
    details: { username, lockedUntil: (state.lockedUntil ?? new Date()).toISOString() },
  };
}

/** Password step. On success goes on to the 2FA step or the requested page. */
export const signInWithPassword = publicAction(SignInInput, async (input) => {
  const username = normalizeUsername(input.username);
  let needsSecondFactor = false;
  try {
    const result = await auth().api.signInUsername({
      body: { username, password: input.password, rememberMe: input.remember },
      headers: await headers(),
    });
    needsSecondFactor = 'twoFactorRedirect' in result && Boolean(result.twoFactorRedirect);
  } catch (err) {
    if (!isAPIError(err)) throw err;
    const code = (err.body as { code?: string } | undefined)?.code;
    if (code === LOGIN_LOCKED) return lockedResult(username);
    if (code === RATE_LIMITED || err.statusCode === 429)
      return { ok: false, code: 'RATE_LIMITED', details: { username } };
    const state = loginLockout(db(), username);
    if (state.locked) return lockedResult(username);
    // The username goes back so the form keeps it; the password never does.
    return { ok: false, code: 'INVALID_CREDENTIALS', details: { username, remaining: state.remaining } };
  }
  const next = safeNext(input.next);
  redirect(needsSecondFactor ? `/login/2fa?next=${encodeURIComponent(next)}` : next);
});

const CodeInput = z.object({
  code: z.string().trim(),
  backup: checkbox.optional().default(false),
  trust: checkbox.optional().default(false),
  next: z.string().optional(),
});

/** Second step: a code from the authenticator app or a backup code. */
export const verifySecondFactor = publicAction(CodeInput, async (input) => {
  const requestHeaders = await headers();
  const key = twoFactorChallengeKey(requestHeaders.get('cookie'));
  if (!key) redirect('/login');

  const code = input.backup ? input.code.replace(/\s+/g, '') : input.code.replace(/\D/g, '');
  if (!input.backup && code.length !== 6)
    return { ok: false, code: 'INVALID_CODE', fieldErrors: { code: ['6'] } };

  try {
    if (input.backup) {
      await auth().api.verifyBackupCode({
        body: { code, trustDevice: input.trust },
        headers: requestHeaders,
      });
    } else {
      await auth().api.verifyTOTP({ body: { code, trustDevice: input.trust }, headers: requestHeaders });
    }
  } catch (err) {
    if (!isAPIError(err)) throw err;
    const errCode = (err.body as { code?: string } | undefined)?.code;
    if (errCode === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' || errCode === 'INVALID_TWO_FACTOR_COOKIE') {
      redirect('/login?reason=second-factor');
    }
    if (err.statusCode === 429) return { ok: false, code: 'RATE_LIMITED' };
    const remaining = Math.max(0, TWO_FACTOR_MAX_ATTEMPTS - twoFactorFailures.count(key!));
    if (remaining === 0) redirect('/login?reason=second-factor');
    return { ok: false, code: input.backup ? 'INVALID_BACKUP_CODE' : 'INVALID_CODE', details: { remaining } };
  }
  redirect(safeNext(input.next));
});

export const signOut = authedAction(z.object({}), async () => {
  await auth().api.signOut({ headers: await headers() });
  redirect('/login');
});
