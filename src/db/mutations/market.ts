import { and, asc, eq, inArray, isNull, max, min, sql } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { fxRates, instruments, operations, prices, pricesLast, PRICE_SOURCES } from '@/db/schema';

type Source = (typeof PRICE_SOURCES)[number];
export interface PricePoint {
  date: string;
  close: string;
  currency: string;
}

export function upsertPrices(
  db: Executor,
  instrumentId: string,
  currency: string,
  source: Source,
  rows: { date: string; close: string }[],
): void {
  for (const r of rows) {
    db.insert(prices)
      .values({ instrumentId, date: r.date, close: r.close, currency, source })
      .onConflictDoUpdate({
        target: [prices.instrumentId, prices.date],
        set: { close: r.close, currency, source },
      })
      .run();
  }
}

export function setLastPrice(
  db: Executor,
  instrumentId: string,
  price: string,
  currency: string,
  source: Source,
  at: Date,
): void {
  db.insert(pricesLast)
    .values({ instrumentId, price, currency, at, source })
    .onConflictDoUpdate({ target: pricesLast.instrumentId, set: { price, currency, at, source } })
    .run();
}

export function upsertFxRates(
  db: Executor,
  rows: { date: string; code: string; rate: string }[],
  source = 'cbr',
): void {
  for (const r of rows) {
    db.insert(fxRates)
      .values({ date: r.date, base: 'RUB', quote: r.code, rate: r.rate, source })
      .onConflictDoUpdate({
        target: [fxRates.date, fxRates.base, fxRates.quote],
        set: { rate: r.rate, source },
      })
      .run();
  }
}

/** Price series per instrument, ascending by date. */
export function loadPriceSeries(db: Executor, instrumentIds: string[]): Map<string, PricePoint[]> {
  const out = new Map<string, PricePoint[]>();
  if (instrumentIds.length === 0) return out;
  const rows = db
    .select({
      instrumentId: prices.instrumentId,
      date: prices.date,
      close: prices.close,
      currency: prices.currency,
    })
    .from(prices)
    .where(inArray(prices.instrumentId, instrumentIds))
    .orderBy(asc(prices.instrumentId), asc(prices.date))
    .all();
  for (const r of rows) {
    const list = out.get(r.instrumentId) ?? [];
    list.push({ date: r.date, close: r.close, currency: r.currency });
    out.set(r.instrumentId, list);
  }
  return out;
}

/** Ruble rates per currency code, ascending by date. RUB itself is always 1. */
export function loadFxSeries(db: Executor, codes: string[]): Map<string, { date: string; rate: string }[]> {
  const out = new Map<string, { date: string; rate: string }[]>();
  const wanted = codes.filter((c) => c !== 'RUB');
  if (wanted.length === 0) return out;
  const rows = db
    .select({ quote: fxRates.quote, date: fxRates.date, rate: fxRates.rate })
    .from(fxRates)
    .where(and(eq(fxRates.base, 'RUB'), inArray(fxRates.quote, wanted)))
    .orderBy(asc(fxRates.quote), asc(fxRates.date))
    .all();
  for (const r of rows) {
    const list = out.get(r.quote) ?? [];
    list.push({ date: r.date, rate: r.rate });
    out.set(r.quote, list);
  }
  return out;
}

export interface InstrumentInUse {
  id: string;
  kind: (typeof instruments.$inferSelect)['kind'];
  ticker: string | null;
  currency: string;
  /** T-Invest uid: prices come from the broker when a token is there. */
  externalUid: string | null;
  meta: Record<string, unknown> | null;
  firstOperationAt: Date;
}

/** Instruments the journal refers to (not voided), with the earliest operation date. */
export function instrumentsInUse(db: Executor): InstrumentInUse[] {
  return db
    .select({
      id: instruments.id,
      kind: instruments.kind,
      ticker: instruments.ticker,
      currency: instruments.currency,
      externalUid: instruments.externalUid,
      meta: instruments.meta,
      firstOperationAt: min(operations.executedAt),
    })
    .from(operations)
    .innerJoin(instruments, eq(instruments.id, operations.instrumentId))
    .where(isNull(operations.voidedAt))
    .groupBy(instruments.id)
    .all()
    .map((r) => ({ ...r, firstOperationAt: new Date(r.firstOperationAt as unknown as number) }));
}

/** Currencies the journal uses, with the earliest operation date. */
export function currenciesInUse(db: Executor): { code: string; since: Date }[] {
  const viaOps = db
    .select({ code: operations.currency, since: min(operations.executedAt) })
    .from(operations)
    .where(isNull(operations.voidedAt))
    .groupBy(operations.currency)
    .all();
  const viaInstruments = db
    .select({ code: instruments.currency, since: min(operations.executedAt) })
    .from(operations)
    .innerJoin(instruments, eq(instruments.id, operations.instrumentId))
    .where(isNull(operations.voidedAt))
    .groupBy(instruments.currency)
    .all();
  const merged = new Map<string, number>();
  for (const r of [...viaOps, ...viaInstruments]) {
    const t = Number(r.since);
    merged.set(r.code, Math.min(merged.get(r.code) ?? t, t));
  }
  return [...merged].map(([code, t]) => ({ code, since: new Date(t) }));
}

export function priceRange(db: Executor, instrumentId: string): { from: string | null; to: string | null } {
  const r = db
    .select({ from: min(prices.date), to: max(prices.date) })
    .from(prices)
    .where(and(eq(prices.instrumentId, instrumentId), sql`${prices.source} != 'manual'`))
    .get();
  return { from: r?.from ?? null, to: r?.to ?? null };
}

export function fxRange(db: Executor, code: string): { from: string | null; to: string | null } {
  const r = db
    .select({ from: min(fxRates.date), to: max(fxRates.date) })
    .from(fxRates)
    .where(and(eq(fxRates.base, 'RUB'), eq(fxRates.quote, code)))
    .get();
  return { from: r?.from ?? null, to: r?.to ?? null };
}

/**
 * «Указать стоимость»: the owner's own valuation of an instrument on a date (custom assets valued by
 * hand, or anything without a quote). Becomes the latest price if it is the newest.
 */
export function setManualPrice(
  db: Executor,
  instrumentId: string,
  date: string,
  close: string,
  currency: string,
  now = new Date(),
): void {
  db.transaction((tx) => {
    tx.insert(prices)
      .values({ instrumentId, date, close, currency, source: 'manual' })
      .onConflictDoUpdate({
        target: [prices.instrumentId, prices.date],
        set: { close, currency, source: 'manual' },
      })
      .run();
    const latest = tx
      .select({ date: max(prices.date) })
      .from(prices)
      .where(eq(prices.instrumentId, instrumentId))
      .get();
    if (latest?.date === date) setLastPrice(tx, instrumentId, close, currency, 'manual', now);
  });
}
