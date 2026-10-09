import { and, asc, eq, gte, inArray, lte, max, ne } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { loadPriceSeries } from '@/db/mutations/market';
import { loadAccountLedger } from '@/db/mutations/positions';
import {
  finAccounts,
  fxRates,
  instruments,
  payoutEvents,
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
import { excessPp, priceReturn, twrGrowth, xirr, type Xirr } from '@/domain/returns';
import { valueOn } from '@/domain/timeline';
import { benchmarkFor } from './benchmarks';
import { getSettings } from './settings';
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
  /** Instrument currency: the currency a manual price is given in. */
  currency: string;
  /** For the one-issuer limit; null counts each security on its own. */
  issuer: string | null;
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
  return hideWalletDust(db, userId, valueCells(db, userId, fx));
}

/**
 * FR-CRY-4: in wallets that hide spam, coins without a price and balances under the threshold are
 * left out of the value when the settings say so («Не считать скрытое в стоимости портфеля»).
 */
function hideWalletDust(db: Db, userId: string, cells: ValuedCell[]): ValuedCell[] {
  const { crypto } = getSettings(db, userId);
  if (!crypto.excludeHidden || !cells.some((c) => c.sourceKind === 'wallet')) return cells;
  const hiding = new Set(
    db
      .select({ id: finAccounts.id, meta: finAccounts.meta })
      .from(finAccounts)
      .where(eq(finAccounts.userId, userId))
      .all()
      .filter((a) => (a.meta as { wallet?: { hideSpam?: boolean } } | null)?.wallet?.hideSpam)
      .map((a) => a.id),
  );
  return cells.filter((c) => {
    if (c.sourceKind !== 'wallet' || c.isCash || !hiding.has(c.accountId)) return true;
    if (crypto.hideUnpriced && (c.priceRub === null || c.approx)) return false;
    return c.valueRub.gte(crypto.dustThresholdRub);
  });
}

function valueCells(db: Db, userId: string, fx: FxSeries): ValuedCell[] {
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
      issuer: instruments.issuer,
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
      currency: r.currency,
      issuer: r.issuer,
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

export function flowsFor(
  ledger: UserLedger,
  scope: Scope,
  fx: FxSeries,
  timeZone: string,
  includeCash = true,
): ExternalFlow[] {
  return externalFlows(
    ledger.flowOps,
    ledger.ctxByAccount,
    scope,
    (currency, at) => rubPer(fx, currency, localDate(at, timeZone)) ?? ONE,
    { includeCash },
  );
}

/** Daily value of an area from the snapshots, ascending by date. */
export function valueSeries(
  db: Db,
  userId: string,
  scope: Scope,
  from: string | null,
  includeCash = true,
): { date: string; value: Decimal }[] {
  const rows = db
    .select({
      date: positionSnapshots.date,
      accountId: positionSnapshots.accountId,
      tagId: positionSnapshots.tagId,
      valueRub: positionSnapshots.valueRub,
      kind: instruments.kind,
    })
    .from(positionSnapshots)
    .innerJoin(instruments, eq(instruments.id, positionSnapshots.instrumentId))
    .where(
      from
        ? and(eq(positionSnapshots.userId, userId), gte(positionSnapshots.date, from))
        : eq(positionSnapshots.userId, userId),
    )
    .orderBy(asc(positionSnapshots.date))
    .all();
  const byDate = new Map<string, Decimal>();
  for (const r of rows) {
    if (!scope(r.accountId, r.tagId) || (!includeCash && r.kind === 'currency')) continue;
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
  /** Own benchmark; null takes the settings default. */
  benchmarkId: string | null;
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
    benchmarkId: p.benchmarkInstrumentId,
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

/**
 * Profit split for the portfolio page (docs/04-calculations.md, section 3): price result (unrealized
 * plus realized) and payouts, in rubles at today's rate. Closed positions count too.
 */
export function profitSplit(db: Db, userId: string, scope: Scope, cells: ValuedCell[], fx: FxSeries) {
  let course = ZERO;
  for (const c of cells)
    if (!c.isCash && scope(c.accountId, c.tagId) && c.costRub)
      course = course.plus(c.valueRub.minus(c.costRub));
  let payouts = ZERO;
  for (const p of db
    .select({
      accountId: positions.accountId,
      tagId: positions.tagId,
      realizedPnl: positions.realizedPnl,
      payoutsTotal: positions.payoutsTotal,
      costCurrency: positions.costCurrency,
      currency: instruments.currency,
    })
    .from(positions)
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .where(eq(positions.userId, userId))
    .all()) {
    if (!scope(p.accountId, p.tagId)) continue;
    const rate = rubPer(fx, p.costCurrency ?? p.currency) ?? ONE;
    course = course.plus(new Decimal(p.realizedPnl).times(rate));
    payouts = payouts.plus(new Decimal(p.payoutsTotal).times(rate));
  }
  return { course, payouts };
}

export interface SeriesPoint {
  date: string;
  value: Decimal;
  invested: Decimal;
}

/** Daily value and cumulative invested of an area; today is the live value. */
export function areaSeries(
  db: Db,
  userId: string,
  scope: Scope,
  flows: ExternalFlow[],
  liveValue: Decimal,
  timeZone: string,
  now = new Date(),
  includeCash = true,
): SeriesPoint[] {
  const today = localDate(now, timeZone);
  const points = valueSeries(db, userId, scope, null, includeCash).filter((p) => p.date < today);
  points.push({ date: today, value: liveValue });
  const sorted = [...flows].sort((a, b) => a.at.getTime() - b.at.getTime());
  let i = 0;
  let invested = ZERO;
  return points.map((p) => {
    for (; i < sorted.length && localDate(sorted[i]!.at, timeZone) <= p.date; i++)
      invested = invested.plus(sorted[i]!.amountRub);
    return { date: p.date, value: p.value, invested };
  });
}

/** A ruble series in another display currency, each day at that day's CBR rate (FR-OVR-5). */
export function convertSeries(
  series: SeriesPoint[],
  fx: FxSeries,
  currency: string,
): { date: string; value: number; invested: number }[] {
  const fallback = rubPer(fx, currency) ?? ONE;
  return series.map((p) => {
    const rate = rubPer(fx, currency, p.date) ?? fallback;
    return { date: p.date, value: p.value.div(rate).toNumber(), invested: p.invested.div(rate).toNumber() };
  });
}

export interface UpcomingPayout {
  instrumentId: string;
  payDate: string;
  kind: (typeof payoutEvents.$inferSelect)['kind'];
  name: string;
  /** Per unit × what the area holds now. */
  amount: Decimal;
  currency: string;
  estimate: boolean;
}

/** The next scheduled payouts of what the area holds (FR-OVR-4, FR-PAY-3). */
export function upcomingPayouts(db: Db, cells: ValuedCell[], today: string, limit = 5): UpcomingPayout[] {
  const held = new Map<string, { quantity: Decimal; cell: ValuedCell }>();
  for (const c of cells) {
    if (c.isCash || c.quantity.lte(0)) continue;
    const h = held.get(c.instrumentId);
    held.set(c.instrumentId, { quantity: (h?.quantity ?? new Decimal(0)).plus(c.quantity), cell: c });
  }
  if (held.size === 0) return [];
  return db
    .select()
    .from(payoutEvents)
    .where(
      and(
        inArray(payoutEvents.instrumentId, [...held.keys()]),
        gte(payoutEvents.payDate, today),
        // Bond schedules run to maturity; «ближайшие» means the coming year.
        lte(payoutEvents.payDate, addDays(today, 366)),
      ),
    )
    .orderBy(asc(payoutEvents.payDate))
    .limit(limit)
    .all()
    .map((e) => {
      const h = held.get(e.instrumentId)!;
      return {
        instrumentId: e.instrumentId,
        payDate: e.payDate,
        kind: e.kind,
        // By name, as in the mockup: «Лукойл», «ОФЗ 26238».
        name: h.cell.name,
        amount: new Decimal(e.amountPerUnit).times(h.quantity),
        currency: e.currency,
        estimate: e.isEstimate,
      };
    });
}

export interface AreaReturns {
  xirr: Xirr | null;
  /** Per day of the series: cumulative TWR growth and the benchmark close (carried over holidays). */
  points: { date: string; growth: Decimal; bench: Decimal | null }[];
  /** «К индексу за год»: the last 365 days, or since the start when the area is younger. */
  year: {
    from: string;
    portfolio: Decimal | null;
    benchmark: Decimal | null;
    pp: Decimal | null;
    fullYear: boolean;
  };
}

/** XIRR, TWR growth against a benchmark, and the one-year gap (docs/04-calculations.md, sections 4, 5). */
export function areaReturns(
  db: Db,
  series: SeriesPoint[],
  flows: ExternalFlow[],
  value: Decimal,
  benchmarkId: string | null,
  timeZone: string,
  now = new Date(),
): AreaReturns {
  const today = localDate(now, timeZone);
  const xirrResult = xirr([
    ...flows.map((f) => ({ date: localDate(f.at, timeZone), amount: f.amountRub.neg() })),
    { date: today, amount: value },
  ]);

  // The series starts at the first snapshot; days before money arrived carry nothing.
  const started = series.findIndex((p) => !p.value.isZero() || !p.invested.isZero());
  const live = started < 0 ? [] : series.slice(started);
  const growth = twrGrowth(
    live.map((p, i) => ({ value: p.value, flow: i === 0 ? ZERO : p.invested.minus(live[i - 1]!.invested) })),
  );

  const closes = benchmarkId ? (loadPriceSeries(db, [benchmarkId]).get(benchmarkId) ?? []) : [];
  let k = 0;
  let last: Decimal | null = null;
  const points = live.map((p, i) => {
    for (; k < closes.length && closes[k]!.date <= p.date; k++) last = new Decimal(closes[k]!.close);
    return { date: p.date, growth: growth[i]!, bench: last };
  });

  const yearAgo = addDays(today, -365);
  // The base is the value a year ago: the last day on or before it; a younger area starts at its first day.
  const before = points.findLastIndex((p) => p.date <= yearAgo);
  const startIdx = Math.max(0, before);
  const first = points[startIdx];
  const end = points.at(-1);
  const portfolio = first && end && end !== first ? end.growth.div(first.growth).minus(1) : null;
  const benchmark = first?.bench && end?.bench ? priceReturn(first.bench, end.bench) : null;
  return {
    xirr: xirrResult,
    points,
    year: {
      from: first?.date ?? today,
      portfolio,
      benchmark,
      pp: excessPp(portfolio, benchmark),
      fullYear: before >= 0,
    },
  };
}

/** XIRR alone, for cards that do not need the daily series. */
export function areaXirr(
  flows: ExternalFlow[],
  value: Decimal,
  timeZone: string,
  now = new Date(),
): Xirr | null {
  return xirr([
    ...flows.map((f) => ({ date: localDate(f.at, timeZone), amount: f.amountRub.neg() })),
    { date: localDate(now, timeZone), amount: value },
  ]);
}

export interface AreaMetrics {
  /** settings.returns.primaryMetric */
  primary: 'xirr' | 'twr';
  xirr: Xirr | null;
  /** TWR since the area started. */
  twr: Decimal | null;
  returns: AreaReturns;
  benchmarkId: string | null;
}

/**
 * Returns of an area as the settings ask (FR-SET-1): with or without free cash, against the
 * portfolio's benchmark or the default one, the primary metric named.
 */
export function areaMetrics(
  db: Db,
  userId: string,
  scope: Scope,
  cells: ValuedCell[],
  ledger: UserLedger,
  fx: FxSeries,
  settings: {
    returns: { includeCash: boolean; primaryMetric: 'xirr' | 'twr'; defaultBenchmarkId: string | null };
    display: { timezone: string };
  },
  portfolioBenchmarkId: string | null,
  now = new Date(),
): AreaMetrics {
  const tz = settings.display.timezone;
  const includeCash = settings.returns.includeCash;
  const flows = flowsFor(ledger, scope, fx, tz, includeCash);
  const value = cells
    .filter((c) => scope(c.accountId, c.tagId) && (includeCash || !c.isCash))
    .reduce((s, c) => s.plus(c.valueRub), ZERO);
  const series = areaSeries(db, userId, scope, flows, value, tz, now, includeCash);
  const benchmarkId = benchmarkFor(db, portfolioBenchmarkId, settings.returns.defaultBenchmarkId);
  const returns = areaReturns(db, series, flows, value, benchmarkId, tz, now);
  const last = returns.points.at(-1);
  return {
    primary: settings.returns.primaryMetric,
    xirr: returns.xirr,
    twr: last && returns.points.length > 1 ? last.growth.minus(1) : null,
    returns,
    benchmarkId,
  };
}

/** The figure cards show: XIRR or TWR since the start, as the settings say. */
export function primaryReturn(m: AreaMetrics): { rate: Decimal; shortPeriod: boolean } | null {
  if (m.primary === 'twr') return m.twr ? { rate: m.twr, shortPeriod: false } : null;
  return m.xirr;
}
