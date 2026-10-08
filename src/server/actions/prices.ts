'use server';

import { and, eq, isNull, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { setManualPrice as storeManualPrice } from '@/db/mutations/market';
import { deleteAccountSnapshots } from '@/db/mutations/snapshots';
import { instruments, positions } from '@/db/schema';
import { enqueueSnapshots } from '@/jobs/market';
import { parseDecimalInput } from '@/lib/parse';
import { localDate } from '@/lib/time';
import { authedAction } from '../action';
import { getSettings } from '../settings';

/** «Указать стоимость» for one unit of an instrument, today unless a date is given. */
export const setManualPrice = authedAction(
  z.object({
    instrumentId: z.string().max(64),
    price: z.preprocess(
      (v) => (typeof v === 'string' ? parseDecimalInput(v) : v),
      z.string().regex(/^\d+(\.\d+)?$/),
    ),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  async ({ instrumentId, price, date }, session) => {
    const userId = session.user.id;
    const inst = db()
      .select({ id: instruments.id, currency: instruments.currency })
      .from(instruments)
      .where(
        and(eq(instruments.id, instrumentId), or(isNull(instruments.userId), eq(instruments.userId, userId))),
      )
      .get();
    if (!inst) return { ok: false, code: 'NOT_FOUND' };
    const day = date ?? localDate(new Date(), getSettings(db(), userId).display.timezone);
    storeManualPrice(db(), instrumentId, day, price, inst.currency);
    // Past values change: rebuild the snapshots of accounts holding it.
    const holders = db()
      .selectDistinct({ accountId: positions.accountId })
      .from(positions)
      .where(eq(positions.instrumentId, instrumentId))
      .all();
    for (const h of holders) deleteAccountSnapshots(db(), h.accountId);
    enqueueSnapshots(db());
    revalidatePath('/', 'layout');
    return { ok: true, data: null };
  },
);
