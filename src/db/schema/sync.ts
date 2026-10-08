import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { timestamp } from './columns';
import { sources } from './ledger';

export const SYNC_TRIGGERS = ['schedule', 'manual', 'api', 'onboarding'] as const;
export const SYNC_STATUSES = ['running', 'ok', 'error'] as const;

/** Wizard and «Источники» progress (docs/03-data-model.md, section 2). */
export interface SyncProgress {
  stage: 'accounts' | 'operations' | 'instruments' | 'prices' | 'reconcile' | 'done';
  accountIndex?: number;
  accountCount?: number;
  accountName?: string;
  year?: number;
  /** 0–100 for the whole run. */
  percent: number;
}

/** One attempt of a source synchronization: the sync log of FR-SRC-3. */
export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    trigger: text('trigger', { enum: SYNC_TRIGGERS }).notNull(),
    status: text('status', { enum: SYNC_STATUSES }).notNull().default('running'),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
    newOperations: integer('new_operations').notNull().default(0),
    progress: text('progress', { mode: 'json' }).$type<SyncProgress>(),
    error: text('error'),
    attempt: integer('attempt').notNull().default(1),
  },
  (t) => [
    index('sync_runs_source_started_idx').on(t.sourceId, t.startedAt),
    check('sync_runs_trigger_check', sql`${t.trigger} in ('schedule', 'manual', 'api', 'onboarding')`),
    check('sync_runs_status_check', sql`${t.status} in ('running', 'ok', 'error')`),
  ],
);
