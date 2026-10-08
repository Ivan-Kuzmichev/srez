import { Cron } from 'croner';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { jobSchedules, jobs } from '@/db/schema';

export type Job = typeof jobs.$inferSelect;

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** While a job with this key is queued or running, new ones with the same key are dropped. */
  singletonKey?: string;
}

/** Returns the new job id, or null if an active job with the same singleton key exists. */
export function enqueue(
  database: Executor,
  name: string,
  payload: unknown = null,
  options: EnqueueOptions = {},
  now = new Date(),
): number | null {
  const row = database
    .insert(jobs)
    .values({
      name,
      payload,
      runAt: options.runAt ?? now,
      maxAttempts: options.maxAttempts ?? 3,
      singletonKey: options.singletonKey ?? null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id })
    .get();
  return row?.id ?? null;
}

/**
 * Atomically takes the next due job. A running job whose lock has expired (the worker died)
 * is taken again; that counts as a new attempt.
 */
export function claimNext(
  database: Executor,
  workerId: string,
  names: readonly string[],
  lockMs: number,
  now = new Date(),
): Job | null {
  if (names.length === 0) return null;
  const nowMs = now.getTime();
  const due = database
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        inArray(jobs.name, [...names]),
        sql`((${jobs.status} = 'queued' and ${jobs.runAt} <= ${nowMs})
          or (${jobs.status} = 'running' and ${jobs.lockedUntil} < ${nowMs}))`,
      ),
    )
    .orderBy(jobs.runAt, jobs.id)
    .limit(1);

  const claimed = database
    .update(jobs)
    .set({
      status: 'running',
      attempt: sql`${jobs.attempt} + 1`,
      lockedBy: workerId,
      lockedUntil: new Date(nowMs + lockMs),
    })
    .where(eq(jobs.id, sql`(${due})`))
    .returning()
    .get();
  return claimed ?? null;
}

export function completeJob(database: Executor, id: number, now = new Date()): void {
  database
    .update(jobs)
    .set({ status: 'done', finishedAt: now, lockedBy: null, lockedUntil: null, lastError: null })
    .where(eq(jobs.id, id))
    .run();
}

/** Seconds before the next attempt: 10, 40, 90, ... capped at one hour. */
export function retryDelayMs(attempt: number): number {
  return Math.min(attempt * attempt * 10_000, 3_600_000);
}

/** Returns true when the job will be retried. */
export function failJob(database: Executor, job: Job, error: string, now = new Date()): boolean {
  const retry = job.attempt < job.maxAttempts;
  database
    .update(jobs)
    .set(
      retry
        ? {
            status: 'queued',
            runAt: new Date(now.getTime() + retryDelayMs(job.attempt)),
            lockedBy: null,
            lockedUntil: null,
            lastError: error,
          }
        : { status: 'failed', finishedAt: now, lockedBy: null, lockedUntil: null, lastError: error },
    )
    .where(eq(jobs.id, job.id))
    .run();
  return retry;
}

export interface ScheduleDef {
  name: string;
  /** Cron expression, evaluated in UTC. */
  cron: string;
  payload?: unknown;
}

/** Brings job_schedules in line with the code: upserts given schedules, removes the rest. */
export function syncSchedules(database: Executor, defs: readonly ScheduleDef[]): void {
  database.transaction((tx) => {
    for (const def of defs) {
      new Cron(def.cron, { paused: true }); // throws on an invalid pattern
      tx.insert(jobSchedules)
        .values({ name: def.name, cron: def.cron, payload: def.payload ?? null })
        .onConflictDoUpdate({
          target: jobSchedules.name,
          set: { cron: def.cron, payload: def.payload ?? null },
        })
        .run();
    }
    const keep = defs.map((d) => d.name);
    const stale = tx.select({ name: jobSchedules.name }).from(jobSchedules).all();
    for (const { name } of stale) {
      if (!keep.includes(name)) tx.delete(jobSchedules).where(eq(jobSchedules.name, name)).run();
    }
  });
}

/**
 * Enqueues every schedule whose next run is due. Missed runs collapse into one job:
 * catching up on skipped days is the job's own business. A new schedule starts counting from now.
 */
export function enqueueDueSchedules(database: Executor, now = new Date()): string[] {
  const enqueued: string[] = [];
  for (const schedule of database.select().from(jobSchedules).all()) {
    if (!schedule.lastEnqueuedAt) {
      database
        .update(jobSchedules)
        .set({ lastEnqueuedAt: now })
        .where(eq(jobSchedules.name, schedule.name))
        .run();
      continue;
    }
    const next = new Cron(schedule.cron, { timezone: 'UTC', paused: true }).nextRun(schedule.lastEnqueuedAt);
    if (!next || next > now) continue;
    database.transaction((tx) => {
      enqueue(tx, schedule.name, schedule.payload, { singletonKey: `schedule:${schedule.name}` }, now);
      tx.update(jobSchedules).set({ lastEnqueuedAt: now }).where(eq(jobSchedules.name, schedule.name)).run();
    });
    enqueued.push(schedule.name);
  }
  return enqueued;
}
