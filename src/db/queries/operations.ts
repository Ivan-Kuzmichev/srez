import { and, count, desc, eq, gte, inArray, isNull, not, or, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, instruments, operations, tags } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { containsCi, startsWithCi } from './search';

export const TYPE_GROUPS = {
  buy: ['buy'],
  sell: ['sell'],
  payout: ['dividend', 'coupon', 'interest'],
  accrual: ['accrual'],
  cashflow: ['deposit', 'withdrawal'],
  charge: ['fee', 'tax'],
} as const satisfies Record<string, readonly (typeof operations.$inferSelect)['type'][]>;
export type TypeGroup = keyof typeof TYPE_GROUPS;

export const PERIODS = ['30d', 'year', 'all'] as const;
export type Period = (typeof PERIODS)[number];

export interface JournalFilters {
  q?: string;
  type?: TypeGroup;
  accountId?: string;
  origin?: 'manual' | 'tinvest' | 'chain' | 'reconcile';
  period: Period;
}

export const PAGE_SIZE = 50;

function periodStart(period: Period, now: Date): Date | null {
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000);
  if (period === 'year') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return null;
}

function where(userId: string, f: JournalFilters, now: Date): SQL {
  const conditions: SQL[] = [eq(operations.userId, userId)];
  const since = periodStart(f.period, now);
  if (since) conditions.push(gte(operations.executedAt, since));
  if (f.type) conditions.push(inArray(operations.type, [...TYPE_GROUPS[f.type]]));
  if (f.accountId) conditions.push(eq(operations.accountId, f.accountId));
  if (f.origin) conditions.push(eq(operations.origin, f.origin));
  const q = f.q?.trim();
  if (q) {
    conditions.push(
      or(
        startsWithCi(instruments.ticker, q),
        containsCi(instruments.name, q),
        containsCi(operations.note, q),
      )!,
    );
  }
  return and(...conditions)!;
}

export interface JournalRow {
  id: string;
  type: (typeof operations.$inferSelect)['type'];
  executedAt: Date;
  quantity: string;
  price: string;
  amount: string;
  currency: string;
  origin: (typeof operations.$inferSelect)['origin'];
  note: string | null;
  accountId: string;
  accountName: string;
  instrumentId: string | null;
  ticker: string | null;
  instrumentName: string | null;
  instrumentKind: (typeof instruments.$inferSelect)['kind'] | null;
  tagId: string | null;
  tagName: string | null;
}

const CHAIN_ACCRUAL = and(eq(operations.type, 'accrual'), eq(operations.origin, 'chain'))!;

export interface AccrualGroup {
  key: string;
  /** «YYYY-MM». */
  month: string;
  accountId: string;
  accountName: string;
  first: Date;
  last: Date;
  assets: string[];
  /** In `currency` at each day's rate; null when a rate is missing. */
  value: Decimal | null;
  rows: { id: string; at: Date; asset: string; units: string; value: Decimal | null }[];
}

/**
 * Chain accruals of the selection, one group per month and account, newest first (FR-OPS-6).
 * A wrapper's accrual counts its base-coin amount (quantity is 0).
 */
export function accrualGroups(
  db: Db,
  userId: string,
  filters: JournalFilters,
  monthOf: (at: Date) => string,
  rateAt: (from: string, at: Date) => Decimal | null,
  now = new Date(),
): AccrualGroup[] {
  const rows = db
    .select({
      id: operations.id,
      at: operations.executedAt,
      quantity: operations.quantity,
      accruedInterest: operations.accruedInterest,
      price: operations.price,
      currency: operations.currency,
      accountId: operations.accountId,
      accountName: finAccounts.name,
      ticker: instruments.ticker,
      name: instruments.name,
    })
    .from(operations)
    .innerJoin(finAccounts, eq(finAccounts.id, operations.accountId))
    .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
    .where(and(where(userId, filters, now), isNull(operations.voidedAt), CHAIN_ACCRUAL))
    .orderBy(desc(operations.executedAt))
    .all();
  const groups = new Map<string, AccrualGroup>();
  for (const r of rows) {
    const month = monthOf(r.at);
    const key = `${month}|${r.accountId}`;
    const units = new Decimal(r.quantity).gt(0) ? new Decimal(r.quantity) : new Decimal(r.accruedInterest);
    const rate = rateAt(r.currency, r.at);
    const value = rate ? units.times(r.price).times(rate) : null;
    const asset = r.ticker ?? r.name ?? '';
    const g = groups.get(key) ?? {
      key,
      month,
      accountId: r.accountId,
      accountName: r.accountName,
      first: r.at,
      last: r.at,
      assets: [],
      value: new Decimal(0),
      rows: [],
    };
    g.first = r.at < g.first ? r.at : g.first;
    g.last = r.at > g.last ? r.at : g.last;
    if (!g.assets.includes(asset)) g.assets.push(asset);
    g.value = g.value && value ? g.value.plus(value) : null;
    g.rows.push({ id: r.id, at: r.at, asset, units: units.toString(), value });
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** One page of the journal, newest first (FR-OPS-1). Voided operations are hidden. */
export function listJournal(db: Db, userId: string, filters: JournalFilters, page: number, now = new Date()) {
  const base = db
    .select({
      id: operations.id,
      type: operations.type,
      executedAt: operations.executedAt,
      quantity: operations.quantity,
      price: operations.price,
      amount: operations.amount,
      currency: operations.currency,
      origin: operations.origin,
      note: operations.note,
      accountId: operations.accountId,
      accountName: finAccounts.name,
      instrumentId: operations.instrumentId,
      ticker: instruments.ticker,
      instrumentName: instruments.name,
      instrumentKind: instruments.kind,
      tagId: operations.tagId,
      tagName: tags.name,
    })
    .from(operations)
    .innerJoin(finAccounts, eq(finAccounts.id, operations.accountId))
    .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
    .leftJoin(tags, eq(tags.id, operations.tagId));
  // Chain accruals come folded by month (FR-OPS-6): see accrualGroups.
  const condition = and(where(userId, filters, now), isNull(operations.voidedAt), not(CHAIN_ACCRUAL));
  const rows: JournalRow[] = base
    .where(condition)
    .orderBy(desc(operations.executedAt), desc(operations.createdAt))
    .limit(PAGE_SIZE)
    .offset(Math.max(0, page - 1) * PAGE_SIZE)
    .all();
  const total =
    db
      .select({ n: count() })
      .from(operations)
      .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
      .where(condition)
      .get()?.n ?? 0;
  return { rows, total };
}

export interface JournalTotals {
  currency: string;
  deposits: Decimal;
  buys: Decimal;
  sells: Decimal;
  payouts: Decimal;
  accruals: Decimal;
  fees: Decimal;
  /** Operations in other currencies, not in the totals until FX rates arrive (phase 3). */
  otherCurrency: number;
}

/** Totals over the whole selection, not just the page (FR-OPS-2). Summed in code with Decimal. */
export function journalTotals(
  db: Db,
  userId: string,
  filters: JournalFilters,
  currency = 'RUB',
  now = new Date(),
  /** Rate of a currency in `currency` on a day: accruals (coins, no cash) are valued with it. */
  rateAt?: (from: string, at: Date) => Decimal | null,
): JournalTotals {
  const rows = db
    .select({
      type: operations.type,
      amount: operations.amount,
      fee: operations.fee,
      currency: operations.currency,
      quantity: operations.quantity,
      price: operations.price,
      accruedInterest: operations.accruedInterest,
      executedAt: operations.executedAt,
    })
    .from(operations)
    .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
    .where(and(where(userId, filters, now), isNull(operations.voidedAt)))
    .all();
  const zero = new Decimal(0);
  const t: JournalTotals = {
    currency,
    deposits: zero,
    buys: zero,
    sells: zero,
    payouts: zero,
    accruals: zero,
    fees: zero,
    otherCurrency: 0,
  };
  for (const r of rows) {
    if (r.type === 'accrual') {
      // No money moves: the coins accrued (or a wrapper's base-coin amount) at that day's price.
      const units = new Decimal(r.quantity).gt(0) ? new Decimal(r.quantity) : new Decimal(r.accruedInterest);
      const rate = r.currency === currency ? new Decimal(1) : (rateAt?.(r.currency, r.executedAt) ?? null);
      if (rate) t.accruals = t.accruals.plus(units.times(r.price).times(rate));
      else t.otherCurrency += 1;
      continue;
    }
    if (r.currency !== currency) {
      t.otherCurrency += 1;
      continue;
    }
    const amount = new Decimal(r.amount);
    const fee = new Decimal(r.fee);
    switch (r.type) {
      case 'deposit':
        t.deposits = t.deposits.plus(amount);
        break;
      case 'buy':
        t.buys = t.buys.plus(amount.plus(fee));
        t.fees = t.fees.minus(fee);
        break;
      case 'sell':
        t.sells = t.sells.plus(amount.plus(fee));
        t.fees = t.fees.minus(fee);
        break;
      case 'dividend':
      case 'coupon':
      case 'interest':
        t.payouts = t.payouts.plus(amount);
        break;
      case 'fee':
        t.fees = t.fees.plus(amount);
        break;
    }
  }
  return t;
}

/** Sources the user has, for the source filter. */
export function listOrigins(db: Db, userId: string): string[] {
  return db
    .selectDistinct({ origin: operations.origin })
    .from(operations)
    .where(eq(operations.userId, userId))
    .all()
    .map((r) => r.origin);
}
