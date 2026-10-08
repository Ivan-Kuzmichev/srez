import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const logs = sqliteTable(
  'logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
    level: text('level', { enum: LOG_LEVELS }).notNull(),
    source: text('source').notNull(),
    message: text('message').notNull(),
    context: text('context', { mode: 'json' }).$type<Record<string, unknown>>(),
    requestId: text('request_id'),
    jobId: text('job_id'),
  },
  (t) => [
    index('logs_ts_idx').on(t.ts),
    index('logs_level_ts_idx').on(t.level, t.ts),
    index('logs_source_ts_idx').on(t.source, t.ts),
    index('logs_request_id_idx').on(t.requestId),
    index('logs_job_id_idx').on(t.jobId),
    check('logs_level_check', sql`${t.level} in ('debug', 'info', 'warn', 'error')`),
  ],
);

/** Raw answers of external APIs, debug mode only, kept 24 hours (docs/03-data-model.md, section 8). */
export const rawResponses = sqliteTable(
  'raw_responses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
    integration: text('integration').notNull(),
    method: text('method').notNull(),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** Secrets cut out before the write. */
    body: text('body', { mode: 'json' }),
  },
  (t) => [index('raw_responses_ts_idx').on(t.ts)],
);
