'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { authedAction } from '../action';
import { updateTokenSettings } from '../api-tokens';
import { applyLogSettings } from '../logger';
import { getSettings, updateSettings } from '../settings';

const AUTO_OFF = { '24h': 86_400_000, '1h': 3_600_000, never: null } as const;

/** «Сохранить» on «Разработка»: debug mode, logging, and the token's name, rights and network limit. */
export const saveDevSettings = authedAction(
  z.object({
    debug: z.object({
      enabled: z.boolean(),
      autoOff: z.enum(['24h', '1h', 'never']),
      /** The owner switched debug on or picked another term: the timer starts over. */
      restart: z.boolean(),
    }),
    logging: z.object({
      level: z.enum(['info', 'warn', 'error']),
      retentionDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
      externalRequests: z.boolean(),
      authEvents: z.boolean(),
      maskAmounts: z.boolean(),
    }),
    token: z
      .object({
        name: z.string().trim().min(1).max(60),
        scopes: z.array(z.enum(['read:data', 'read:logs', 'run:sync'])).max(3),
        localOnly: z.boolean(),
      })
      .nullable(),
  }),
  async ({ debug, logging, token }, session) => {
    const userId = session.user.id;
    const before = getSettings(db(), userId).debug;
    const off = AUTO_OFF[debug.autoOff];
    // The timer starts when debug is switched on or its term is changed, not on every save.
    const keep = before.enabled && debug.enabled && !debug.restart && before.autoOffAt !== null;
    const autoOffAt = !debug.enabled || off === null ? null : keep ? before.autoOffAt : Date.now() + off;
    const saved = updateSettings(db(), userId, { debug: { enabled: debug.enabled, autoOffAt }, logging });
    applyLogSettings(saved);
    if (token) updateTokenSettings(db(), userId, token);
    revalidatePath('/settings/dev', 'layout');
    return { ok: true, data: null };
  },
);
