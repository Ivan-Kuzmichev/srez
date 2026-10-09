import type { Db } from '@/db/client';
import { loadPriceSeries } from '@/db/mutations/market';
import { Decimal } from '@/domain/decimal';
import {
  beta,
  dailyReturns,
  largest,
  limitChecks,
  maxDrawdown,
  riskCurrencies,
  volatility,
  worstMonth,
  type Holding,
  type IndexPoint,
} from '@/domain/risk';
import { everything, type Scope } from '@/domain/scope';
import { addDays, localDate } from '@/lib/time';
import {
  areaMetrics,
  loadFx,
  loadUserLedger,
  loadValuedCells,
  type PortfolioRow,
  portfolioScope,
} from './portfolio-data';
import type { Settings } from './settings';

const ZERO = new Decimal(0);
const isWeekday = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

export interface RiskData {
  value: Decimal;
  /** The whole TWR index, for the drawdown chart and its periods. */
  index: IndexPoint[];
  /** Cards are over the last year. */
  drawdown: ReturnType<typeof maxDrawdown>;
  volatility: Decimal | null;
  benchmarkVolatility: Decimal | null;
  benchmarkId: string | null;
  beta: Decimal | null;
  worstMonth: ReturnType<typeof worstMonth>;
  largest: ReturnType<typeof largest>;
  currencies: ReturnType<typeof riskCurrencies>;
  limits: ReturnType<typeof limitChecks>;
}

/**
 * «Риск» (FR-ANL-1…5) of the selected portfolio or of everything. Daily returns are taken over
 * weekdays (Friday to Monday is one step), so the √252 annualisation fits; beta pairs the area with
 * the benchmark over the benchmark's own trading days.
 */
export function riskData(
  db: Db,
  userId: string,
  portfolio: PortfolioRow | null,
  settings: Settings,
  now = new Date(),
): RiskData {
  const tz = settings.display.timezone;
  const fx = loadFx(db);
  const cells = loadValuedCells(db, userId, fx);
  const scope: Scope = portfolio ? portfolioScope(portfolio) : everything;
  const m = areaMetrics(
    db,
    userId,
    scope,
    cells,
    loadUserLedger(db, userId),
    fx,
    settings,
    portfolio?.benchmarkId ?? null,
    now,
  );
  const index = m.returns.points.map((p) => ({ date: p.date, index: p.growth }));
  const yearAgo = addDays(localDate(now, tz), -365);
  const startIdx = Math.max(
    0,
    index.findLastIndex((p) => p.date <= yearAgo),
  );
  const year = index.slice(startIdx);

  const weekdays = year.filter((p) => isWeekday(p.date)).map((p) => p.index);
  const closes = m.benchmarkId
    ? (loadPriceSeries(db, [m.benchmarkId]).get(m.benchmarkId) ?? []).filter(
        (c) => c.date >= (year[0]?.date ?? yearAgo),
      )
    : [];
  const byDate = new Map(year.map((p) => [p.date, p.index]));
  const pairs: { portfolio: Decimal; benchmark: Decimal }[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = byDate.get(closes[i - 1]!.date);
    const b = byDate.get(closes[i]!.date);
    const c0 = new Decimal(closes[i - 1]!.close);
    if (!a || !b || a.lte(0) || c0.lte(0)) continue;
    pairs.push({ portfolio: b.div(a).minus(1), benchmark: new Decimal(closes[i]!.close).div(c0).minus(1) });
  }

  // Holdings of the area, one per instrument; a share counts what the area holds of it.
  const byInstrument = new Map<string, Holding>();
  let value = ZERO;
  for (const c of cells) {
    if (!scope(c.accountId, c.tagId) || (!settings.returns.includeCash && c.isCash)) continue;
    value = value.plus(c.valueRub);
    const h = byInstrument.get(c.instrumentId);
    if (h) h.value = h.value.plus(c.valueRub);
    else
      byInstrument.set(c.instrumentId, {
        instrumentId: c.instrumentId,
        ticker: c.ticker,
        name: c.name,
        kind: c.kind,
        assetClass: c.assetClass,
        currency: c.isCash ? (c.ticker ?? c.currency) : c.currency,
        issuer: c.issuer,
        isCash: c.isCash,
        value: c.valueRub,
      });
  }
  const holdings = [...byInstrument.values()];

  return {
    value,
    index,
    drawdown: maxDrawdown(year),
    volatility: volatility(dailyReturns(weekdays)),
    benchmarkVolatility: volatility(dailyReturns(closes.map((c) => new Decimal(c.close)))),
    benchmarkId: m.benchmarkId,
    beta: beta(pairs),
    worstMonth: worstMonth(year),
    largest: largest(holdings, value),
    currencies: riskCurrencies(holdings, value),
    limits: limitChecks(holdings, value, settings.limits),
  };
}
