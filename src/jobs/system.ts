import { asc, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { logs, rawResponses, user } from '@/db/schema';
import { ownerSettings, updateSettings } from '@/server/settings';
import { defineJob } from './runner';

/** Test job from phase 0: proves the worker, the schedule and the log table are alive. */
export const heartbeat = defineJob({
  name: 'system.heartbeat',
  payload: z.null(),
  handler({ log }) {
    log.debug('Worker heartbeat');
  },
});

/**
 * Hourly housekeeping (FR-DEV-1, 2): logs past their retention, raw answers past 24 hours, and
 * debug mode switched off once its time is up.
 */
export function cleanup(db: Executor, now = new Date()): { logs: number; raw: number; debugOff: boolean } {
  const s = ownerSettings(db);
  const logCut = new Date(now.getTime() - s.logging.retentionDays * 86_400_000);
  const rawCut = new Date(now.getTime() - 86_400_000);
  const removedLogs = db.delete(logs).where(lt(logs.ts, logCut)).run().changes;
  const removedRaw = db.delete(rawResponses).where(lt(rawResponses.ts, rawCut)).run().changes;
  let debugOff = false;
  if (s.debug.enabled && s.debug.autoOffAt !== null && s.debug.autoOffAt <= now.getTime()) {
    const owner = db.select({ id: user.id }).from(user).orderBy(asc(user.createdAt)).get();
    if (owner) updateSettings(db, owner.id, { debug: { enabled: false, autoOffAt: null } });
    debugOff = true;
  }
  return { logs: removedLogs, raw: removedRaw, debugOff };
}

export const cleanupJob = defineJob({
  name: 'system.cleanup',
  payload: z.null(),
  handler({ db, log }) {
    const result = cleanup(db);
    if (result.logs || result.raw || result.debugOff) log.info(result, 'Cleanup done');
  },
});
