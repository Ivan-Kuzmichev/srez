import { and, asc, eq, gte, inArray, max, ne } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { loadAccountLedger } from '@/db/mutations/positions';
import {
  finAccounts,
  fxRates,
  instruments,
  portfolioRules,
  portfolios,
  portfolioTargets,
  positions,
  positionSnapshots,
  prices,
  pricesLast,
  sources,
  tags,
} from '@/db/schema';
import { allocation, type AssetClass, type ClassShare } from '@/domain/allocation';
import { Decimal } from '@/domain/decimal';
import { dayChange, externalFlows, type ExternalFlow, type FlowOperation } from '@/domain/flows';
import type { LedgerContext } from '@/domain/ledger-types';
import { everything, scopeOf, type Scope, type ScopeRule } from '@/domain/scope';
import { valueOn } from '@/domain/timeline';
import { addDays, localDate } from '@/lib/time';

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

export type FxSeries = Map<string, { date: string; rate: string }[]>;

/** Ruble rates by currency for any date: the CBR rate of that day or the last earlier one. */
export function loadFx(db: Db): FxSeries {
  const out: FxSeries = new Map();
  for (const r of db
    .select({ quote: fxRates.quote, date: fxRates.date, rate: fxRates.rate })
    .from(fxRates)
    .where(eq(fxRates.base, 'RUB'))
    .orderBy(asc(fxRates.quote), asc(fxRates.date))
    .all()) {
    const list = out.get(r.quote) ?? [];
    list.push({ date: r.date, rate: r.rate });
    out.set(r.quote, list);
  }
  return out;
}

/** Rubles per unit of `currency` on `date` (latest when no date); null when unknown. */
export function rubPer(fx: FxSeries, currency: string, date?: string): Decimal | null {
  if (currency === 'RUB') return ONE;
  const series = fx.get(currency);
  if (!series || series.length === 0) return null;
  const point = date ? (valueOn(series, date) ?? series[0]!) : series[series.length - 1]!;
  return new Decimal(point.rate);
}

export interface ValuedCell {
  accountId: string;
  accountName: string;
  sourceKind: string;
  instrumentId: string;
  tagId: string | null;
  kind: string;
  assetClass: AssetClass;
  ticker: string | null;
  name: string;
  isCash: boolean;
  quantity: Decimal;
  /** Current price in rubles; null when valued without a price. */
  priceRub: Decimal | null;
  valueRub: Decimal;
  /** Average price and cost basis converted to rubles at today's rate (cash: null). */
  avgPriceRub: Decimal | null;
  costRub: Decimal | null;
  /** True when no market price was known: valued at the average price. */
  approx: boolean;
}

/** Every open cell of the user's accounts, valued now (latest price, latest rate). */
export function loadValuedCells(db: Db, userId: string, fx: FxSeries): ValuedCell[] {
  const rows = db
    .select({
      accountId: positions.accountId,
      accountName: finAccounts.name,
      sourceKind: sources.kind,
      instrumentId: positions.instrumentId,
      tagId: positions.tagId,
      quantity: positions.quantity,
      costBasis: positions.costBasis,
      avgPrice: positions.avgPrice,
      costCurrency: positions.costCurrency,
      kind: instruments.kind,
      assetClass: instruments.assetClass,
      ticker: instruments.ticker,
      name: instruments.name,
      currency: instruments.currency,
      lastPrice: pricesLast.price,
      lastCurrency: pricesLast.currency,
    })
    .from(positions)
    .innerJoin(finAccounts, eq(finAccounts.id, positions.accountId))
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .leftJoin(pricesLast, eq(pricesLast.instrumentId, positions.instrumentId))
    .where(and(eq(positions.userId, userId), ne(positions.quantity, '0')))
    .all();

  // Instruments without a live quote fall back to their latest daily close.
  const missing = rows.filter((r) => !r.lastPrice && r.kind !== 'currency').map((r) => r.instrumentId);
  const lastClose = new Map<string, { close: string; currency: string }>();
  if (missing.length > 0) {
    const latest = db
      .select({ instrumentId: prices.instrumentId, date: max(prices.date) })
      .from(prices)
      .where(inArray(prices.instrumentId, missing))
      .groupBy(prices.instrumentId)
      .all();
    for (const l of latest) {
      const p = db
        .select({ close: prices.close, currency: prices.currency })
        .from(prices)
        .where(and(eq(prices.instrumentId, l.instrumentId), eq(prices.date, l.date!)))
        .get();
      if (p) lastClose.set(l.instrumentId, p);
    }
  }

  return rows.map((r) => {
    const quantity = new Decimal(r.quantity);
    const isCash = r.kind === 'currency';
    const costRate = rubPer(fx, r.costCurrency ?? r.currency) ?? ONE;
    if (isCash) {
      const rate = rubPer(fx, r.ticker ?? r.currency);
      return {
        ...base(r),
        isCash,
        quantity,
        priceRub: rate,
        valueRub: quantity.times(rate ?? ONE),
        avgPriceRub: null,
        costRub: null,
        approx: !rate,
      };
    }
    const quote = r.lastPrice
      ? { close: r.lastPrice, currency: r.lastCurrency! }
      : lastClose.get(r.instrumentId);
    const quoteRate = quote ? rubPer(fx, quote.currency) : null;
    const priceRub = quote && quoteRate ? new Decimal(quote.close).times(quoteRate) : null;
    const avgPriceRub = new Decimal(r.avgPrice).times(costRate);
    return {
      ...base(r),
      isCash,
      quantity,
      priceRub,
      valueRub: quantity.times(priceRub ?? avgPriceRub),
      avgPriceRub,
      costRub: new Decimal(r.costBasis).times(costRate),
      approx: !priceRub,
    };
  });

  function base(r: (typeof rows)[number]) {
    return {
      accountId: r.accountId,
      accountName: r.accountName,
      sourceKind: r.sourceKind,
      instrumentId: r.instrumentId,
      tagId: r.tagId,
      kind: r.kind,
      assetClass: r.assetClass as AssetClass,
      ticker: r.ticker,
      name: r.name,
    };
  }
}

export interface UserLedger {
  flowOps: FlowOperation[];
  ctxByAccount: Map<string, LedgerContext>;
}

/** All operations of the user with the tag context of their accounts, for flows. */
export function loadUserLedger(db: Db, userId: string): UserLedger {
  const accounts = db.select().from(finAccounts).where(eq(finAccounts.userId, userId)).all();
  const flowOps: FlowOperation[] = [];
  const ctxByAccount = new Map<string, LedgerContext>();
  for (const account of accounts) {
    const { ops, ctx } = loadAccountLedger(db, account);
    ctxByAccount.set(account.id, ctx);
    for (const op of ops) flowOps.push({ ...op, accountId: account.id });
  }
  return { flowOps, ctxByAccount };
}

export function flowsFor(ledger: UserLedger, scope: Scope, fx: FxSeries, timeZone: string): ExternalFlow[] {
  return externalFlows(
    ledger.flowOps,
    ledger.ctxByAccount,
    scope,
    (currency, at) => rubPer(fx, currency, localDate(at, timeZone)) ?? ONE,
  );
}

/** Daily value of an area from the snapshots, ascending by date. */
export function valueSeries(
  db: Db,
  userId: string,
  scope: Scope,
  from: string | null,
): { date: string; value: Decimal }[] {
  const rows = db
    .select({
      date: positionSnapshots.date,
      accountId: positionSnapshots.accountId,
      tagId: positionSnapshots.tagId,
      valueRub: positionSnapshots.valueRub,
    })
    .from(positionSnapshots)
    .where(
      from
        ? and(eq(positionSnapshots.userId, userId), gte(positionSnapshots.date, from))
        : eq(positionSnapshots.userId, userId),
    )
    .orderBy(asc(positionSnapshots.date))
    .all();
  const byDate = new Map<string, Decimal>();
  for (const r of rows) {
    if (!scope(r.accountId, r.tagId)) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? ZERO).plus(r.valueRub));
  }
  return [...byDate].map(([date, value]) => ({ date, value }));
}

export interface AreaSummary {
  value: Decimal;
  invested: Decimal;
  profit: Decimal;
  profitPct: Decimal | null;
  dayChange: Decimal | null;
  dayChangePct: Decimal | null;
  approx: boolean;
  cells: ValuedCell[];
  classes: ClassShare[];
}

/** Value, invested, profit, day change and structure of an area right now. */
export function summarizeArea(
  db: Db,
  userId: string,
  scope: Scope,
  cells: ValuedCell[],
  ledger: UserLedger,
  fx: FxSeries,
  timeZone: string,
  targets: { values: Map<AssetClass, Decimal>; threshold: Decimal } | null,
  now = new Date(),
): AreaSummary {
  const inArea = cells.filter((c) => scope(c.accountId, c.tagId));
  const value = inArea.reduce((s, c) => s.plus(c.valueRub), ZERO);
  const flows = flowsFor(ledger, scope, fx, timeZone);
  const invested = flows.reduce((s, f) => s.plus(f.amountRub), ZERO);
  const profit = value.minus(invested);

  const today = localDate(now, timeZone);
  const yesterday = addDays(today, -1);
  const yesterdayPoint = valueSeries(db, userId, scope, yesterday).find((p) => p.date === yesterday);
  const flowToday = flows
    .filter((f) => localDate(f.at, timeZone) === today)
    .reduce((s, f) => s.plus(f.amountRub), ZERO);
  const day = yesterdayPoint ? dayChange(value, yesterdayPoint.value, flowToday) : null;

  const byClass = new Map<AssetClass, Decimal>();
  for (const c of inArea) byClass.set(c.assetClass, (byClass.get(c.assetClass) ?? ZERO).plus(c.valueRub));

  return {
    value,
    invested,
    profit,
    profitPct: invested.gt(0) ? profit.div(invested).times(100) : null,
    dayChange: day?.change ?? null,
    dayChangePct: day?.pct ?? null,
    approx: inArea.some((c) => c.approx),
    cells: inArea,
    classes: allocation(byClass, targets?.values ?? null, targets?.threshold ?? new Decimal(5)),
  };
}

export interface PortfolioRow {
  id: string;
  name: string;
  deviationThreshold: Decimal;
  targetsEnabled: boolean;
  rules: ScopeRule[];
  targets: Map<AssetClass, Decimal>;
}

export function listPortfolios(db: Db, userId: string): PortfolioRow[] {
  const list = db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .orderBy(asc(portfolios.sort), asc(portfolios.createdAt))
    .all();
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);
  const rules = db.select().from(portfolioRules).where(inArray(portfolioRules.portfolioId, ids)).all();
  const targets = db.select().from(portfolioTargets).where(inArray(portfolioTargets.portfolioId, ids)).all();
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    deviationThreshold: new Decimal(p.deviationThreshold),
    targetsEnabled: p.targetsEnabled,
    rules: rules
      .filter((r) => r.portfolioId === p.id)
      .map((r) => ({ accountId: r.accountId, mode: r.mode, tagId: r.tagId })),
    targets: new Map(
      targets
        .filter((t) => t.portfolioId === p.id)
        .map((t) => [t.assetClass as AssetClass, new Decimal(t.targetPct)]),
    ),
  }));
}

export const portfolioScope = (p: PortfolioRow): Scope => scopeOf(p.rules);
export { everything };

export function tagNames(db: Db, userId: string): Map<string, string> {
  return new Map(
    db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(eq(tags.userId, userId))
      .all()
      .map((t) => [t.id, t.name]),
  );
}
