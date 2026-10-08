import { z } from 'zod';
import type { Executor } from '@/db/client';
import { recalcAccount } from '@/db/mutations/positions';
import { enqueue } from './queue';
import { defineJob } from './runner';

export const RECALC_JOB = 'positions.recalc';

/** Called after any change to an account's operations. One waiting job per account is enough. */
export function enqueueRecalc(db: Executor, accountId: string): void {
  enqueue(db, RECALC_JOB, { accountId }, { singletonKey: `${RECALC_JOB}:${accountId}` });
}

export const recalcPositions = defineJob({
  name: RECALC_JOB,
  payload: z.object({ accountId: z.string().min(1) }),
  handler({ db, payload, log }) {
    const started = Date.now();
    const { issues } = recalcAccount(db, payload.accountId);
    if (issues.length > 0)
      log.warn({ accountId: payload.accountId, issues }, 'Positions recalculated with issues');
    log.debug({ accountId: payload.accountId, durationMs: Date.now() - started }, 'Positions recalculated');
  },
});
