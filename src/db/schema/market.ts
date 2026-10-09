import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { createdAt, date, decimal, id, timestamp } from './columns';
import { ASSET_CLASSES, finAccounts, instruments, tags } from './ledger';

export const PRICE_SOURCES = ['moex', 'coingecko', 'tinvest', 'cbr', 'manual'] as const;

/** Daily closing prices (docs/03-data-model.md, section 3). */
export const prices = sqliteTable(
  'prices',
  {
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    close: decimal('close').notNull(),
    currency: text('currency').notNull(),
    source: text('source', { enum: PRICE_SOURCES }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.date] })],
);

/** The latest known price per instrument. */
export const pricesLast = sqliteTable('prices_last', {
  instrumentId: text('instrument_id')
    .primaryKey()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  price: decimal('price').notNull(),
  currency: text('currency').notNull(),
  at: timestamp('at').notNull(),
  source: text('source', { enum: PRICE_SOURCES }).notNull(),
});

/** Official rates: `rate` rubles for one unit of `quote`; base is always RUB. */
export const fxRates = sqliteTable(
  'fx_rates',
  {
    date: date('date').notNull(),
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: decimal('rate').notNull(),
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.base, t.quote] })],
);

/**
 * Value at the end of a day per (account, instrument, tag). Derived: rebuilt from operations, prices
 * and rates. `approx` marks a value taken at cost because no price was known.
 */
export const positionSnapshots = sqliteTable(
  'position_snapshots',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    tagId: text('tag_id'),
    quantity: decimal('quantity').notNull(),
    price: decimal('price').notNull(),
    currency: text('currency').notNull(),
    value: decimal('value').notNull(),
    valueRub: decimal('value_rub').notNull(),
    approx: integer('approx', { mode: 'boolean' }).notNull().default(false),
  },
  // Unique (date, account, instrument, tag) with a nullable tag: expression index in drizzle/0008_market_indexes.sql.
  (t) => [
    index('position_snapshots_user_date_idx').on(t.userId, t.date),
    index('position_snapshots_account_idx').on(t.accountId, t.date),
  ],
);

export const portfolios = sqliteTable(
  'portfolios',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    benchmarkInstrumentId: text('benchmark_instrument_id').references(() => instruments.id, {
      onDelete: 'set null',
    }),
    /** Percentage points; a class further off its target than this is flagged. */
    deviationThreshold: decimal('deviation_threshold').notNull().default('5'),
    targetsEnabled: integer('targets_enabled', { mode: 'boolean' }).notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('portfolios_user_idx').on(t.userId)],
);

export const PORTFOLIO_MODES = ['all', 'tag'] as const;

/** An account without a rule is not part of the portfolio. */
export const portfolioRules = sqliteTable(
  'portfolio_rules',
  {
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: PORTFOLIO_MODES }).notNull(),
    tagId: text('tag_id').references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.portfolioId, t.accountId] }),
    check('portfolio_rules_mode_check', sql`${t.mode} in ('all', 'tag')`),
    check('portfolio_rules_tag_check', sql`(${t.mode} = 'tag') = (${t.tagId} is not null)`),
  ],
);

export const portfolioTargets = sqliteTable(
  'portfolio_targets',
  {
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    assetClass: text('asset_class', { enum: ASSET_CLASSES }).notNull(),
    targetPct: decimal('target_pct').notNull(),
  },
  (t) => [primaryKey({ columns: [t.portfolioId, t.assetClass] })],
);

/** One row per user; `data` follows SettingsSchema with defaults (src/server/settings.ts). */
export const settings = sqliteTable('settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const PAYOUT_KINDS = ['dividend', 'coupon', 'redemption', 'amortization', 'offer'] as const;

/** Payout schedule of an instrument (docs/03-data-model.md, section 3): coupons, declared dividends, maturity. */
export const payoutEvents = sqliteTable(
  'payout_events',
  {
    id: id(),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: PAYOUT_KINDS }).notNull(),
    recordDate: date('record_date'),
    payDate: date('pay_date').notNull(),
    amountPerUnit: decimal('amount_per_unit').notNull(),
    currency: text('currency').notNull(),
    source: text('source', { enum: PRICE_SOURCES }).notNull(),
    /** A floating coupon not fixed yet, or an amount the issuer has not announced. */
    isEstimate: integer('is_estimate', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('payout_events_instrument_kind_pay_idx').on(t.instrumentId, t.kind, t.payDate),
    index('payout_events_pay_date_idx').on(t.payDate),
    check(
      'payout_events_kind_check',
      sql`${t.kind} in ('dividend', 'coupon', 'redemption', 'amortization', 'offer')`,
    ),
  ],
);

/** «Сохранить как план» (FR-RBL-4): what was entered and what came out, as of that moment. */
export const rebalancePlans = sqliteTable(
  'rebalance_plans',
  {
    id: id(),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    input: text('input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    result: text('result', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('rebalance_plans_portfolio_idx').on(t.portfolioId, t.createdAt)],
);

/** Daily balances of yield tokens for accruals (docs/03-data-model.md, section 3; docs/04, section 10). */
export const walletBalances = sqliteTable(
  'wallet_balances',
  {
    date: date('date').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    instrumentId: text('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    balance: decimal('balance').notNull(),
    /** Wrapped tokens: the rate to the base coin that day. */
    rate: decimal('rate'),
  },
  (t) => [primaryKey({ columns: [t.date, t.accountId, t.instrumentId] })],
);

/**
 * Daily totals of an account's cell (account, tag), written with the snapshots and rebuilt with them
 * (docs/03-data-model.md, section 3): value series read thousands of rows instead of every position.
 */
export const snapshotTotals = sqliteTable(
  'snapshot_totals',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => finAccounts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id'),
    valueRub: decimal('value_rub').notNull(),
    /** The cash part of value_rub: «Учитывать свободный кэш» off takes it out. */
    cashRub: decimal('cash_rub').notNull(),
  },
  (t) => [
    index('snapshot_totals_user_date_idx').on(t.userId, t.date),
    index('snapshot_totals_account_idx').on(t.accountId, t.date),
  ],
);
