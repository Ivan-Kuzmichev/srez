import type { z } from 'zod';
import type { Db } from '@/db/client';
import {
  claimNext,
  completeJob,
  enqueueDueSchedules,
  failJob,
  syncSchedules,
  type Job,
  type ScheduleDef,
} from './queue';

export interface JobLog {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface JobContext<P> {
  db: Db;
  job: Job;
  payload: P;
  /** Correlates every record written while handling this job. */
  jobId: string;
}

export interface JobDefinition<P = unknown> {
  name: string;
  payload: z.ZodType<P>;
  /** How long a claimed job stays locked before another worker may take it over. */
  lockMs?: number;
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
  log: JobLog;
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
  const started = Date.now();
  try {
    const payload = def.payload.parse(job.payload);
    await def.handler({ db, job, payload, jobId });
    completeJob(db, job.id);
    log.info({ jobId, job: job.name, attempt: job.attempt, durationMs: Date.now() - started }, 'Job done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retry = failJob(db, job, message);
    log.error({ jobId, job: job.name, attempt: job.attempt, retry, err }, 'Job failed');
  }
  return true;
}

export function startWorker(options: WorkerOptions): { stop(): Promise<void> } {
  const pollMs = options.pollMs ?? 1000;
  syncSchedules(options.db, options.schedules);

  let stopping = false;
  const loop = (async () => {
    while (!stopping) {
      let worked = false;
      try {
        worked = await runOnce(options);
      } catch (err) {
        options.log.error({ err }, 'Worker loop error');
      }
      if (!worked && !stopping) await new Promise((r) => setTimeout(r, pollMs));
    }
  })();

  return {
    async stop() {
      stopping = true;
      await loop;
    },
  };
}
