'use server';

import { isAPIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authedAction } from '../action';
import { auth } from '../auth';
import { logger } from '../logger';

/** Better Auth checks that the passkey belongs to the signed-in user. */
export const deletePasskey = authedAction(
  z.object({ id: z.string().min(1).max(64) }),
  async ({ id }, session) => {
    try {
      await auth().api.deletePasskey({ body: { id }, headers: await headers() });
    } catch (err) {
      if (isAPIError(err)) return { ok: false, code: 'NOT_FOUND' };
      throw err;
    }
    logger('auth').info(
      { username: session.user.username, event: 'passkey_deleted', passkeyId: id },
      'Passkey deleted',
    );
    revalidatePath('/settings/security');
    return { ok: true, data: null };
  },
);

/** Registration itself runs in the browser (WebAuthn); this only records the event and refreshes. */
export const passkeyAdded = authedAction(
  z.object({ name: z.string().max(64).optional() }),
  async ({ name }, session) => {
    logger('auth').info({ username: session.user.username, event: 'passkey_added', name }, 'Passkey added');
    revalidatePath('/settings/security');
    return { ok: true, data: null };
  },
);
