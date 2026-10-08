'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { applyFix, ReconcileError, snoozeDiscrepancy, undoFix } from '@/db/mutations/reconcile';
import { sources } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { enqueueSync } from '@/jobs/tinvest-sync';
import { parseDecimalInput } from '@/lib/parse';
import { zonedLocalToUtc } from '@/lib/time';
import { authedAction } from '../action';
import { getSettings } from '../settings';

const done = () => {
  revalidatePath('/', 'layout');
  return { ok: true as const, data: null };
};
const failed = (err: unknown) => {
  if (err instanceof ReconcileError) return { ok: false as const, code: err.code };
  throw err;
};

/** FR-REC-4: a fix from the screen; the price arrives as typed («1 234,5»). */
export const applyReconcileFix = authedAction(
  z.object({
    discrepancyId: z.coerce.number().int().positive(),
    fix: z.enum(['transfer', 'trade', 'split', 'cash', 'redemption', 'exclude']),
    date: z.iso.date(),
    price: z.string().max(40).optional(),
  }),
  async ({ discrepancyId, fix, date, price }, session) => {
    const tz = getSettings(db(), session.user.id).display.timezone;
    const typed = price?.trim() ? parseDecimalInput(price) : null;
    if (price?.trim() && (!typed || new Decimal(typed).lte(0))) return { ok: false, code: 'PRICE' };
    const executedAt = zonedLocalToUtc(`${date}T12:00`, tz);
    if (!executedAt) return { ok: false, code: 'INVALID_INPUT' };
    try {
      applyFix(db(), session.user.id, discrepancyId, {
        fix,
        executedAt,
        price: typed ? new Decimal(typed) : null,
      });
    } catch (err) {
      return failed(err);
    }
    return done();
  },
);

export const undoReconcileFix = authedAction(
  z.object({ discrepancyId: z.number().int().positive() }),
  async ({ discrepancyId }, session) => {
    try {
      undoFix(db(), session.user.id, discrepancyId);
    } catch (err) {
      return failed(err);
    }
    return done();
  },
);

export const snoozeReconcile = authedAction(
  z.object({ discrepancyId: z.number().int().positive(), snoozed: z.boolean() }),
  async ({ discrepancyId, snoozed }, session) => {
    try {
      snoozeDiscrepancy(db(), session.user.id, discrepancyId, snoozed);
    } catch (err) {
      return failed(err);
    }
    return done();
  },
);

/** «Сверить заново»: the check runs at the end of every sync. */
export const recheckSource = authedAction(
  z.object({ sourceId: z.string().min(1) }),
  async ({ sourceId }, session) => {
    const own = db()
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.userId, session.user.id), eq(sources.kind, 'tinvest')))
      .get();
    if (!own) return { ok: false, code: 'NOT_FOUND' };
    enqueueSync(db(), sourceId, 'manual');
    return done();
  },
);
