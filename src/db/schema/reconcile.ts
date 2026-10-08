import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { decimal, timestamp } from './columns';
import { finAccounts, instruments, operations } from './ledger';

export const RECONCILE_GUESSES = ['transfer', 'fx', 'redemption', 'split', 'unknown'] as const;
export const DISCREPANCY_STATUSES = ['open', 'resolved', 'ignored', 'snoozed'] as const;

/** Journal against broker (docs/03-data-model.md, section 7; FR-REC-2). */
export const discrepancies = sqliteTable(
  'discrepancies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    ledgerQty: decimal('ledger_qty').notNull(),
    brokerQty: decimal('broker_qty').notNull(),
    guess: text('guess', { enum: RECONCILE_GUESSES }).notNull(),
    status: text('status', { enum: DISCREPANCY_STATUSES }).notNull().default('open'),
    /** The `reconcile` operation that fixed it; undoing the fix reopens the discrepancy. */
    resolutionOperationId: text('resolution_operation_id').references(() => operations.id, {
      onDelete: 'set null',
    }),
    detectedAt: timestamp('detected_at').notNull(),
    resolvedAt: timestamp('resolved_at'),
  },
  (t) => [
    // One discrepancy in work per pair: open or snoozed.
    uniqueIndex('discrepancies_active_idx')
      .on(t.accountId, t.instrumentId)
      .where(sql`${t.status} in ('open', 'snoozed')`),
    index('discrepancies_account_idx').on(t.accountId, t.status),
    check(
      'discrepancies_guess_check',
      sql`${t.guess} in ('transfer', 'fx', 'redemption', 'split', 'unknown')`,
    ),
    check('discrepancies_status_check', sql`${t.status} in ('open', 'resolved', 'ignored', 'snoozed')`),
  ],
);

/** Securities the owner took out of reconciliation (FR-REC-5). */
export const reconcileExclusions = sqliteTable(
  'reconcile_exclusions',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.instrumentId] })],
);
