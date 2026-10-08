import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    runAt: integer('run_at', { mode: 'timestamp_ms' }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    singletonKey: text('singleton_key'),
    lockedBy: text('locked_by'),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('jobs_status_run_at_idx').on(t.status, t.runAt),
    // At most one unfinished job per singleton key.
    uniqueIndex('jobs_singleton_active_idx')
      .on(t.singletonKey)
      .where(sql`${t.singletonKey} is not null and ${t.status} in ('queued', 'running')`),
    check('jobs_status_check', sql`${t.status} in ('queued', 'running', 'done', 'failed')`),
  ],
);

export const jobSchedules = sqliteTable('job_schedules', {
  name: text('name').primaryKey(),
  cron: text('cron').notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>(),
  lastEnqueuedAt: integer('last_enqueued_at', { mode: 'timestamp_ms' }),
});
