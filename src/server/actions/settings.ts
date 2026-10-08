'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { authedAction } from '../action';
import { updateSettings } from '../settings';

/** «Цены и курсы» (FR-SET-3). */
export const savePriceSettings = authedAction(
  z.object({
    refreshMinutes: z.coerce.number().pipe(z.union([z.literal(15), z.literal(60), z.literal(1440)])),
    snapshotTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  async (prices, session) => {
    updateSettings(db(), session.user.id, { prices });
    revalidatePath('/settings');
    return { ok: true, data: null };
  },
);
