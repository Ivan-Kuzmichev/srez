import { sql } from 'drizzle-orm';
import { blob, check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { createdAt, date, decimal, id, timestamp, updatedAt } from './columns';

export const SOURCE_KINDS = ['tinvest', 'wallet', 'manual'] as const;
export const SOURCE_STATUSES = ['ok', 'error', 'disabled'] as const;
export const ACCOUNT_KINDS = ['broker', 'iis', 'wallet', 'deposit', 'other'] as const;
export const INSTRUMENT_KINDS = ['share', 'bond', 'etf', 'currency', 'crypto', 'index', 'custom'] as const;
export const ASSET_CLASSES = ['stocks', 'bonds', 'funds', 'crypto', 'cash', 'other'] as const;
export const OPERATION_TYPES = [
  'buy',
  'sell',
  'dividend',
  'coupon',
  'interest',
  'accrual',
  'deposit',
  'withdrawal',
  'fee',
  'tax',
  'transfer_in',
  'transfer_out',
  'fx_buy',
  'fx_sell',
  'redemption',
  'amortization',
  'split',
  'other',
] as const;
export const OPERATION_ORIGINS = ['tinvest', 'chain', 'manual', 'reconcile'] as const;

const inList = (column: unknown, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

export const sources = sqliteTable(
  'sources',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SOURCE_KINDS }).notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: SOURCE_STATUSES }).notNull().default('ok'),
    secretEncrypted: blob('secret_encrypted', { mode: 'buffer' }),
    scheduleMinutes: integer('schedule_minutes'),
    lastSyncAt: timestamp('last_sync_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sources_user_idx').on(t.userId),
    check('sources_kind_check', inList(t.kind, SOURCE_KINDS)),
    check('sources_status_check', inList(t.status, SOURCE_STATUSES)),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('tags_user_name_idx').on(t.userId, t.name)],
);

export const finAccounts = sqliteTable(
  'fin_accounts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    externalId: text('external_id'),
    name: text('name').notNull(),
    kind: text('kind', { enum: ACCOUNT_KINDS }).notNull(),
    currency: text('currency').notNull(),
    syncEnabled: integer('sync_enabled', { mode: 'boolean' }).notNull().default(true),
    openedAt: date('opened_at'),
    closedAt: date('closed_at'),
    defaultTagId: text('default_tag_id').references(() => tags.id, { onDelete: 'set null' }),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex('fin_accounts_source_external_idx')
      .on(t.sourceId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('fin_accounts_user_idx').on(t.userId),
    check('fin_accounts_kind_check', inList(t.kind, ACCOUNT_KINDS)),
  ],
);

export const instruments = sqliteTable(
  'instruments',
  {
    id: id(),
    kind: text('kind', { enum: INSTRUMENT_KINDS }).notNull(),
    assetClass: text('asset_class', { enum: ASSET_CLASSES }).notNull(),
    ticker: text('ticker'),
    name: text('name').notNull(),
    isin: text('isin'),
    figi: text('figi'),
    externalUid: text('external_uid'),
    currency: text('currency').notNull(),
    lot: decimal('lot').notNull().default('1'),
    issuer: text('issuer'),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    /** Only for kind = custom: the owner of a self-made asset. */
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('instruments_ticker_idx').on(t.ticker),
    uniqueIndex('instruments_isin_idx')
      .on(t.isin)
      .where(sql`${t.isin} is not null`),
    uniqueIndex('instruments_external_uid_idx')
      .on(t.externalUid)
      .where(sql`${t.externalUid} is not null`),
    // Crypto is unique by meta.coingeckoId: expression index in drizzle/0006_ledger_indexes.sql.
    uniqueIndex('instruments_currency_idx')
      .on(t.ticker)
      .where(sql`${t.kind} = 'currency'`),
    index('instruments_user_idx').on(t.userId),
    check('instruments_kind_check', inList(t.kind, INSTRUMENT_KINDS)),
    check('instruments_class_check', inList(t.assetClass, ASSET_CLASSES)),
  ],
);

export const tagRules = sqliteTable(
  'tag_rules',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id').references(() => instruments.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  // Unique (account, instrument) with a nullable instrument: expression index in drizzle/0006_ledger_indexes.sql.
  (t) => [index('tag_rules_account_idx').on(t.accountId)],
);

export const operations = sqliteTable(
  'operations',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'restrict' }),
    instrumentId: text('instrument_id').references(() => instruments.id, { onDelete: 'restrict' }),
    type: text('type', { enum: OPERATION_TYPES }).notNull(),
    executedAt: timestamp('executed_at').notNull(),
    quantity: decimal('quantity').notNull().default('0'),
    price: decimal('price').notNull().default('0'),
    currency: text('currency').notNull(),
    amount: decimal('amount').notNull().default('0'),
    fee: decimal('fee').notNull().default('0'),
    tax: decimal('tax').notNull().default('0'),
    accruedInterest: decimal('accrued_interest').notNull().default('0'),
    tagId: text('tag_id').references(() => tags.id, { onDelete: 'set null' }),
    note: text('note'),
    origin: text('origin', { enum: OPERATION_ORIGINS }).notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    externalId: text('external_id'),
    /** Imported operations: survives a change of the broker's id (docs/05-integrations.md). */
    fingerprint: text('fingerprint'),
    raw: text('raw', { mode: 'json' }),
    voidedAt: timestamp('voided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('operations_source_external_idx')
      .on(t.sourceId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('operations_source_fingerprint_idx')
      .on(t.sourceId, t.fingerprint)
      .where(sql`${t.fingerprint} is not null`),
    index('operations_account_executed_idx').on(t.accountId, t.executedAt),
    index('operations_instrument_executed_idx').on(t.instrumentId, t.executedAt),
    index('operations_user_executed_idx').on(t.userId, t.executedAt),
    check('operations_type_check', inList(t.type, OPERATION_TYPES)),
    check('operations_origin_check', inList(t.origin, OPERATION_ORIGINS)),
  ],
);

/** Derived: rewritten by positions.recalc, never edited by hand. */
export const positions = sqliteTable(
  'positions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').references(() => tags.id, { onDelete: 'set null' }),
    quantity: decimal('quantity').notNull(),
    costBasis: decimal('cost_basis').notNull(),
    avgPrice: decimal('avg_price').notNull(),
    realizedPnl: decimal('realized_pnl').notNull(),
    payoutsTotal: decimal('payouts_total').notNull(),
    /** Currency of cost_basis and avg_price: the trades' currency (BTC bought for rubles → RUB). */
    costCurrency: text('cost_currency'),
    firstBuyAt: timestamp('first_buy_at'),
    updatedAt: timestamp('updated_at').notNull(),
  },
  // The contract's key (account, instrument, tag) has a nullable tag, and SQLite treats NULLs as distinct:
  // a unique expression index lives in drizzle/0006_ledger_indexes.sql (drizzle-kit mangles expressions).
  (t) => [index('positions_user_idx').on(t.userId)],
);

export const lots = sqliteTable(
  'lots',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    tagId: text('tag_id'),
    openOperationId: text('open_operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    openedAt: timestamp('opened_at').notNull(),
    quantity: decimal('quantity').notNull(),
    remaining: decimal('remaining').notNull(),
    unitCost: decimal('unit_cost').notNull(),
  },
  (t) => [index('lots_cell_idx').on(t.accountId, t.instrumentId)],
);

export const lotClosures = sqliteTable(
  'lot_closures',
  {
    id: id(),
    lotId: text('lot_id')
      .notNull()
      .references(() => lots.id, { onDelete: 'cascade' }),
    closeOperationId: text('close_operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    closedAt: timestamp('closed_at').notNull(),
    quantity: decimal('quantity').notNull(),
    cost: decimal('cost').notNull(),
    proceeds: decimal('proceeds').notNull(),
    pnl: decimal('pnl').notNull(),
    holdingDays: integer('holding_days').notNull(),
  },
  (t) => [index('lot_closures_lot_idx').on(t.lotId), index('lot_closures_closed_idx').on(t.closedAt)],
);
