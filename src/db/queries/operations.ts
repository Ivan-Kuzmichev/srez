import { and, count, desc, eq, gte, inArray, isNull, or, type SQL } from 'drizzle-orm';
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
  const condition = and(where(userId, filters, now), isNull(operations.voidedAt));
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
): JournalTotals {
  const rows = db
    .select({
      type: operations.type,
      amount: operations.amount,
      fee: operations.fee,
      currency: operations.currency,
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
      case 'accrual':
        t.accruals = t.accruals.plus(amount);
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
