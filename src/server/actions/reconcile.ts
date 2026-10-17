'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { applyFix, ReconcileError, snoozeDiscrepancy, undoFix } from '@/db/mutations/reconcile';
import { sources } from '@/db/schema';
import { enqueueSync } from '@/jobs/tinvest-sync';
import { authedAction } from '../action';
import { FixRequest, fixInput } from '../reconcile-fix';
import { getSettings } from '../settings';

const done = () => {
  revalidatePath('/', 'layout');
  return { ok: true as const, data: null };
};
const failed = (err: unknown) => {
  if (err instanceof ReconcileError)
    return { ok: false as const, code: err.code, ...(err.detail ? { details: { value: err.detail } } : {}) };
  throw err;
};

/** FR-REC-4: a fix from the screen; the price arrives as typed («1 234,5»). */
export const applyReconcileFix = authedAction(
  FixRequest.extend({ discrepancyId: z.coerce.number().int().positive() }),
  async ({ discrepancyId, ...request }, session) => {
    const input = fixInput(request, getSettings(db(), session.user.id).display.timezone);
    if ('code' in input)
      return input.code === 'SPLIT_RATIO'
        ? { ok: false, code: input.code, details: { value: String(input.index) } }
        : { ok: false, code: input.code };
    try {
      applyFix(db(), session.user.id, discrepancyId, input);
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
