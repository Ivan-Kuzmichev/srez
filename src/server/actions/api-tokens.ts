'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { authedAction } from '../action';
import {
  issueToken,
  reissueToken,
  revokeToken,
  TOKEN_TTLS,
  updateTokenSettings,
  type TokenTtl,
} from '../api-tokens';
import { logger } from '../logger';

// write:data is reserved (docs/06-api.md, section 2): the screen shows it, but it cannot be granted yet.
const Scopes = z.array(z.enum(['read:data', 'read:logs', 'run:sync'])).max(3);
const Ttl = z.enum(Object.keys(TOKEN_TTLS) as [TokenTtl, ...TokenTtl[]]);
const Name = z.string().trim().min(1).max(60);

const log = () => logger('auth');

/** Shown once: the plain token goes back to the screen and nowhere else. */
export const issueApiToken = authedAction(
  z.object({ name: Name, ttl: Ttl, scopes: Scopes, localOnly: z.boolean() }),
  async (input, session) => {
    const { token, row } = issueToken(db(), session.user.id, input);
    log().info(
      { event: 'api_token_issued', name: row.name, scopes: row.scopes, localOnly: row.localOnly },
      'API token issued',
    );
    revalidatePath('/settings/dev');
    return { ok: true, data: { token } };
  },
);

export const reissueApiToken = authedAction(z.object({ ttl: Ttl }), async ({ ttl }, session) => {
  const result = reissueToken(db(), session.user.id, ttl);
  if (!result) return { ok: false, code: 'NOT_FOUND' };
  log().info({ event: 'api_token_reissued', name: result.row.name }, 'API token reissued');
  revalidatePath('/settings/dev');
  return { ok: true, data: { token: result.token } };
});

export const revokeApiToken = authedAction(z.object({}), async (_input, session) => {
  if (!revokeToken(db(), session.user.id)) return { ok: false, code: 'NOT_FOUND' };
  log().info({ event: 'api_token_revoked' }, 'API token revoked');
  revalidatePath('/settings/dev');
  return { ok: true, data: null };
});

export const saveApiTokenSettings = authedAction(
  z.object({ name: Name, scopes: Scopes, localOnly: z.boolean() }),
  async (input, session) => {
    if (!updateTokenSettings(db(), session.user.id, input)) return { ok: false, code: 'NOT_FOUND' };
    revalidatePath('/settings/dev');
    return { ok: true, data: null };
  },
);
