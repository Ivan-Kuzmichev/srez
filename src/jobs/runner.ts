import type { z } from 'zod';
import type { Db } from '@/db/client';
import { logContext } from '@/server/log-context';
import type { Logger } from '@/server/logger';
import {
  claimNext,
  completeJob,
  enqueueDueSchedules,
  failJob,
  syncSchedules,
  type Job,
  type ScheduleDef,
} from './queue';

export interface JobContext<P> {
  db: Db;
  job: Job;
  payload: P;
  /** Correlates every record written while handling this job. */
  jobId: string;
  /** Child logger with `jobId` bound. */
  log: Logger;
}

export interface JobDefinition<P = unknown> {
  name: string;
  payload: z.ZodType<P>;
  /** How long a claimed job stays locked before another worker may take it over. */
  lockMs?: number;
  /**
   * `slow` jobs (network, minutes long) run in their own lane, so a first sync does not hold up
   * position recalculation after the owner edits an operation.
   */
  lane?: 'slow';
  handler(ctx: JobContext<P>): Promise<void> | void;
}

export function defineJob<P>(def: JobDefinition<P>): JobDefinition<P> {
  return def;
}

export interface WorkerOptions {
  db: Db;
  workerId: string;
  definitions: readonly JobDefinition<never>[];
  schedules: readonly ScheduleDef[];
  /** Logger with source `jobs`. */
  log: Logger;
  pollMs?: number;
}

const DEFAULT_LOCK_MS = 10 * 60_000;

export function jobIdOf(job: Job): string {
  return `job_${job.id}`;
}

/** Runs one due job if there is one. Returns false when the queue had nothing to do. */
export async function runOnce(options: WorkerOptions, now = new Date()): Promise<boolean> {
  const { db, workerId, definitions, log } = options;
  enqueueDueSchedules(db, now);

  const byName = new Map(definitions.map((d) => [d.name, d as unknown as JobDefinition<unknown>]));
  const job = claimNext(db, workerId, [...byName.keys()], DEFAULT_LOCK_MS, now);
  if (!job) return false;

  const def = byName.get(job.name)!;
  const jobId = jobIdOf(job);
  const jobLog = log.child({ jobId });
  const started = Date.now();
  try {
    const payload = def.payload.parse(job.payload);
    await logContext.run({ jobId }, () => def.handler({ db, job, payload, jobId, log: jobLog }));
    completeJob(db, job.id);
    jobLog.debug({ job: job.name, attempt: job.attempt, durationMs: Date.now() - started }, 'Job done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Errors that say so (TinvestError: a revoked token, no access) are not worth another attempt.
    const retryable = !(err instanceof Error && 'retryable' in err && err.retryable === false);
    const retry = failJob(db, job, message, new Date(), retryable);
    jobLog.error({ job: job.name, attempt: job.attempt, retry, err }, 'Job failed');
  }
  return true;
}

export function startWorker(options: WorkerOptions): { stop(): Promise<void> } {
  const pollMs = options.pollMs ?? 1000;
  syncSchedules(options.db, options.schedules);

  let stopping = false;
  const lanes = [
    options.definitions.filter((d) => d.lane !== 'slow'),
    options.definitions.filter((d) => d.lane === 'slow'),
  ].filter((defs) => defs.length > 0);
  const loops = lanes.map((definitions) =>
    (async () => {
      while (!stopping) {
        let worked = false;
        try {
          worked = await runOnce({ ...options, definitions });
        } catch (err) {
          options.log.error({ err }, 'Worker loop error');
        }
        if (!worked && !stopping) await new Promise((r) => setTimeout(r, pollMs));
      }
    })(),
  );

  return {
    async stop() {
      stopping = true;
      await Promise.all(loops);
    },
  };
}
