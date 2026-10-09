import type { AssetClass } from './allocation';
import { Decimal } from './decimal';

/** docs/04-calculations.md, section 13. */
export type HoldingGroup = 'under1' | 'from1to3' | 'over3';
export type RealizedMethod = 'fifo' | 'average';

const ZERO = new Decimal(0);

const plusYears = (d: Date, n: number) => {
  const x = new Date(d.getTime());
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
};

/** Under a year, one to three years, over three years (calendar years from the purchase). */
export function holdingGroup(openedAt: Date, closedAt: Date): HoldingGroup {
  if (closedAt < plusYears(openedAt, 1)) return 'under1';
  if (closedAt > plusYears(openedAt, 3)) return 'over3';
  return 'from1to3';
}

/** One closed lot piece, already in rubles: cost at the purchase day's rate, proceeds at the sale's. */
export interface ClosedPiece {
  saleId: string;
  openedAt: Date;
  closedAt: Date;
  quantity: Decimal;
  costRub: Decimal;
  proceedsRub: Decimal;
}

/** A sale as a whole, for the average method, in rubles. */
export interface SaleTotal {
  saleId: string;
  quantity: Decimal;
  proceedsRub: Decimal;
  averageCostRub: Decimal;
}

export interface SaleInfo {
  saleId: string;
  instrumentId: string;
  accountId: string;
  assetClass: AssetClass;
  closedAt: Date;
}

export interface TradeRow extends SaleInfo {
  group: HoldingGroup;
  quantity: Decimal;
  /** Per unit, rubles. */
  buyPrice: Decimal;
  sellPrice: Decimal;
  /** The shortest holding in the row: from the latest purchase it includes. */
  openedAt: Date;
  pnl: Decimal;
}

/**
 * Closed trades of a period: one row per sale and holding group (a sale that closed lots of different
 * ages splits, so «больше трёх лет» stays exact). By the average method the cost is the sale's average
 * cost, spread over the groups by quantity; the holding periods still come from the lots.
 */
export function tradeRows(
  pieces: readonly ClosedPiece[],
  sales: readonly SaleInfo[],
  method: RealizedMethod,
  averages: ReadonlyMap<string, SaleTotal> = new Map(),
): TradeRow[] {
  const rows: TradeRow[] = [];
  const bySale = new Map<string, ClosedPiece[]>();
  for (const p of pieces) bySale.set(p.saleId, [...(bySale.get(p.saleId) ?? []), p]);
  for (const sale of sales) {
    const mine = bySale.get(sale.saleId) ?? [];
    if (mine.length === 0) continue;
    const total = mine.reduce((s, p) => s.plus(p.quantity), ZERO);
    const avg = averages.get(sale.saleId);
    const groups = new Map<HoldingGroup, ClosedPiece[]>();
    for (const p of mine) {
      const g = holdingGroup(p.openedAt, p.closedAt);
      groups.set(g, [...(groups.get(g) ?? []), p]);
    }
    for (const [group, ps] of groups) {
      const quantity = ps.reduce((s, p) => s.plus(p.quantity), ZERO);
      const proceeds = ps.reduce((s, p) => s.plus(p.proceedsRub), ZERO);
      const cost =
        method === 'average' && avg
          ? avg.averageCostRub.times(quantity).div(total)
          : ps.reduce((s, p) => s.plus(p.costRub), ZERO);
      rows.push({
        ...sale,
        group,
        quantity,
        buyPrice: quantity.isZero() ? ZERO : cost.div(quantity),
        sellPrice: quantity.isZero() ? ZERO : proceeds.div(quantity),
        openedAt: ps.reduce((m, p) => (p.openedAt > m ? p.openedAt : m), ps[0]!.openedAt),
        pnl: proceeds.minus(cost),
      });
    }
  }
  return rows.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
}

export interface RealizedSummary {
  sales: Decimal;
  gains: Decimal;
  losses: Decimal;
  payouts: Decimal;
  fees: Decimal;
  taxes: Decimal;
  /** sales + payouts − fees − taxes. */
  total: Decimal;
  byClass: { assetClass: AssetClass; trades: number; pnl: Decimal }[];
  byGroup: { group: HoldingGroup; trades: number; pnl: Decimal }[];
}

/** The year's result; rows are the trade rows, the other figures already summed in rubles. */
export function realizedSummary(
  rows: readonly TradeRow[],
  payouts: Decimal,
  fees: Decimal,
  taxes: Decimal,
): RealizedSummary {
  const gains = rows.filter((r) => r.pnl.gt(0)).reduce((s, r) => s.plus(r.pnl), ZERO);
  const losses = rows.filter((r) => r.pnl.lt(0)).reduce((s, r) => s.plus(r.pnl), ZERO);
  const sales = gains.plus(losses);
  const classes = new Map<AssetClass, { sales: Set<string>; pnl: Decimal }>();
  for (const r of rows) {
    const c = classes.get(r.assetClass) ?? { sales: new Set<string>(), pnl: ZERO };
    c.sales.add(r.saleId);
    c.pnl = c.pnl.plus(r.pnl);
    classes.set(r.assetClass, c);
  }
  const groups = (['under1', 'from1to3', 'over3'] as const).map((group) => {
    const rs = rows.filter((r) => r.group === group);
    return { group, trades: rs.length, pnl: rs.reduce((s, r) => s.plus(r.pnl), ZERO) };
  });
  return {
    sales,
    gains,
    losses,
    payouts,
    fees,
    taxes,
    total: sales.plus(payouts).minus(fees).minus(taxes),
    byClass: [...classes]
      .map(([assetClass, c]) => ({ assetClass, trades: c.sales.size, pnl: c.pnl }))
      .sort((a, b) => b.pnl.comparedTo(a.pnl)),
    byGroup: groups.filter((g) => g.trades > 0),
  };
}
