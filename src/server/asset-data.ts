import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, instruments, operations, positions, prices, sources, tags } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { OperationType } from '@/domain/ledger-types';
import { everything, type Scope } from '@/domain/scope';
import { localDate } from '@/lib/time';
import {
  listPortfolios,
  loadFx,
  loadValuedCells,
  portfolioScope,
  rubPer,
  type PortfolioRow,
} from './portfolio-data';
import { getSettings } from './settings';

const ZERO = new Decimal(0);

export interface AssetMarker {
  date: string;
  kind: 'buy' | 'sell' | 'payout';
}

export interface AssetView {
  instrument: typeof instruments.$inferSelect;
  portfolio: PortfolioRow | null;
  /** Where it is held: account, its source, the tag of the cell. */
  holdings: { accountName: string; sourceKind: string; tagName: string | null }[];
  quantity: Decimal;
  valueRub: Decimal;
  shareOfArea: Decimal | null;
  avgPrice: Decimal | null;
  /** Average and current price in this currency. */
  priceCurrency: string;
  price: Decimal | null;
  courseRub: Decimal;
  coursePct: Decimal | null;
  payoutsRub: Decimal;
  totalRub: Decimal;
  /** Total result against everything put into this security. */
  totalPct: Decimal | null;
  operations: {
    id: string;
    at: Date;
    type: OperationType;
    quantity: Decimal;
    price: Decimal;
    amount: Decimal;
    currency: string;
    accountName: string;
  }[];
  chart: { date: string; price: number }[];
  markers: AssetMarker[];
  firstBuy: string | null;
  portfolios: { id: string; name: string; quantity: Decimal; share: Decimal }[];
  overallShare: Decimal | null;
  limit: { pct: number; ok: boolean } | null;
}

/**
 * Asset page (FR-AST-1…3): the position in the chosen area — a portfolio, or every account —
 * its price with trades and payouts, its operations, and where it counts.
 */
export function assetView(
  db: Db,
  userId: string,
  instrumentId: string,
  portfolioId?: string,
): AssetView | null {
  const instrument = db.select().from(instruments).where(eq(instruments.id, instrumentId)).get();
  if (
    !instrument ||
    (instrument.userId !== null && instrument.userId !== userId) ||
    instrument.kind === 'index'
  )
    return null;
  const settings = getSettings(db, userId);
  const tz = settings.display.timezone;
  const all = listPortfolios(db, userId);
  const portfolio = all.find((p) => p.id === portfolioId) ?? null;
  const scope: Scope = portfolio ? portfolioScope(portfolio) : everything;
  const fx = loadFx(db);
  const cells = loadValuedCells(db, userId, fx);
  const mine = cells.filter((c) => c.instrumentId === instrumentId && scope(c.accountId, c.tagId));
  const area = cells.filter((c) => scope(c.accountId, c.tagId));
  const areaValue = area.reduce((s, c) => s.plus(c.valueRub), ZERO);

  const quantity = mine.reduce((s, c) => s.plus(c.quantity), ZERO);
  const valueRub = mine.reduce((s, c) => s.plus(c.valueRub), ZERO);
  const costRub = mine.reduce((s, c) => s.plus(c.costRub ?? ZERO), ZERO);

  const posRows = db
    .select({
      accountId: positions.accountId,
      tagId: positions.tagId,
      quantity: positions.quantity,
      avgPrice: positions.avgPrice,
      costBasis: positions.costBasis,
      realized: positions.realizedPnl,
      payouts: positions.payoutsTotal,
      costCurrency: positions.costCurrency,
    })
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.instrumentId, instrumentId)))
    .all()
    .filter((p) => scope(p.accountId, p.tagId));
  const costCurrency = posRows.find((p) => p.costCurrency)?.costCurrency ?? instrument.currency;
  const rate = rubPer(fx, costCurrency) ?? new Decimal(1);
  let realizedRub = ZERO;
  let payoutsRub = ZERO;
  let costNative = ZERO;
  for (const p of posRows) {
    realizedRub = realizedRub.plus(new Decimal(p.realized).times(rate));
    payoutsRub = payoutsRub.plus(new Decimal(p.payouts).times(rate));
    costNative = costNative.plus(p.costBasis);
  }
  const avgPrice = quantity.gt(0) ? costNative.div(quantity) : null;
  const lastPrice = mine.find((c) => c.priceRub)?.priceRub ?? null;
  // Prices are shown in the trades' currency, like the average.
  const price = lastPrice ? lastPrice.div(rate) : null;
  const unrealized = valueRub.minus(costRub);
  const courseRub = unrealized.plus(realizedRub);

  const accountRows = db
    .select({
      id: finAccounts.id,
      name: finAccounts.name,
      sourceKind: sources.kind,
      defaultTagId: finAccounts.defaultTagId,
    })
    .from(finAccounts)
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .where(eq(finAccounts.userId, userId))
    .all();
  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  const tagNames = new Map(
    db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(eq(tags.userId, userId))
      .all()
      .map((t) => [t.id, t.name]),
  );

  const ops = db
    .select()
    .from(operations)
    .where(and(eq(operations.userId, userId), eq(operations.instrumentId, instrumentId)))
    .orderBy(asc(operations.executedAt))
    .all()
    .filter((o) => scope(o.accountId, o.tagId ?? accounts.get(o.accountId)?.defaultTagId ?? null));
  const invested = ops
    .filter((o) => o.type === 'buy' || o.type === 'transfer_in')
    .reduce((s, o) => {
      const r = rubPer(fx, o.currency, localDate(o.executedAt, tz)) ?? new Decimal(1);
      const gross = o.type === 'buy' ? new Decimal(o.amount).abs() : new Decimal(o.quantity).times(o.price);
      return s.plus(gross.times(r));
    }, ZERO);
  const totalRub = courseRub.plus(payoutsRub);

  const series = db
    .select({ date: prices.date, close: prices.close })
    .from(prices)
    .where(eq(prices.instrumentId, instrumentId))
    .orderBy(asc(prices.date))
    .all();
  const markers: AssetMarker[] = ops
    .filter((o) =>
      ['buy', 'sell', 'transfer_in', 'dividend', 'coupon', 'interest', 'amortization', 'redemption'].includes(
        o.type,
      ),
    )
    .map((o) => ({
      date: localDate(o.executedAt, tz),
      kind: o.type === 'buy' || o.type === 'transfer_in' ? 'buy' : o.type === 'sell' ? 'sell' : 'payout',
    }));
  const firstBuy = markers.find((m) => m.kind === 'buy')?.date ?? null;

  const counted = all
    .map((p) => {
      const s = portfolioScope(p);
      const inP = cells.filter((c) => s(c.accountId, c.tagId));
      const total = inP.reduce((x, c) => x.plus(c.valueRub), ZERO);
      const own = inP.filter((c) => c.instrumentId === instrumentId);
      const q = own.reduce((x, c) => x.plus(c.quantity), ZERO);
      const v = own.reduce((x, c) => x.plus(c.valueRub), ZERO);
      return { id: p.id, name: p.name, quantity: q, share: total.gt(0) ? v.div(total).times(100) : ZERO };
    })
    .filter((p) => p.quantity.gt(0));
  const totalAll = cells.reduce((s, c) => s.plus(c.valueRub), ZERO);
  const valueAll = cells
    .filter((c) => c.instrumentId === instrumentId)
    .reduce((s, c) => s.plus(c.valueRub), ZERO);
  const overallShare = totalAll.gt(0) ? valueAll.div(totalAll).times(100) : null;
  const limitPct = settings.limits.singleStockPct;

  const holdingKeys = new Set<string>();
  const holdings = mine
    .filter((c) => c.quantity.gt(0))
    .map((c) => ({
      accountName: accounts.get(c.accountId)?.name ?? '',
      sourceKind: accounts.get(c.accountId)?.sourceKind ?? '',
      tagName: c.tagId ? (tagNames.get(c.tagId) ?? null) : null,
    }))
    .filter((h) => {
      const k = `${h.accountName}|${h.tagName}`;
      if (holdingKeys.has(k)) return false;
      holdingKeys.add(k);
      return true;
    });

  return {
    instrument,
    portfolio,
    holdings,
    quantity,
    valueRub,
    shareOfArea: areaValue.gt(0) ? valueRub.div(areaValue).times(100) : null,
    avgPrice,
    priceCurrency: costCurrency,
    price,
    courseRub,
    coursePct: costRub.gt(0) ? unrealized.div(costRub).times(100) : null,
    payoutsRub,
    totalRub,
    totalPct: invested.gt(0) ? totalRub.div(invested).times(100) : null,
    operations: ops
      .slice()
      .reverse()
      .map((o) => ({
        id: o.id,
        at: o.executedAt,
        type: o.type,
        quantity: new Decimal(o.quantity),
        price: new Decimal(o.price),
        amount: new Decimal(o.amount),
        currency: o.currency,
        accountName: accounts.get(o.accountId)?.name ?? '',
      })),
    chart: series.map((p) => ({ date: p.date, price: Number(p.close) })),
    markers,
    firstBuy,
    portfolios: counted,
    overallShare,
    limit:
      instrument.kind === 'share' && overallShare ? { pct: limitPct, ok: overallShare.lte(limitPct) } : null,
  };
}
