import { desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { instruments, rebalancePlans } from '@/db/schema';
import type { AssetClass } from '@/domain/allocation';
import { Decimal } from '@/domain/decimal';
import { ordersFor, rebalance, type Candidate, type RebalanceInput } from '@/domain/rebalance';
import { listPortfolios, loadFx, loadValuedCells, portfolioScope, type PortfolioRow } from './portfolio-data';

export interface RebalanceBase {
  portfolio: PortfolioRow;
  values: Map<AssetClass, Decimal>;
  targets: Map<AssetClass, Decimal>;
  /** The largest position of each class: what a trade in that class goes into (section 8). */
  candidates: Map<AssetClass, Candidate>;
  lastPlanAt: Date | null;
}

export function rebalanceBase(db: Db, userId: string, portfolioId: string): RebalanceBase | null {
  const portfolio = listPortfolios(db, userId).find((p) => p.id === portfolioId);
  if (!portfolio) return null;
  const scope = portfolioScope(portfolio);
  const cells = loadValuedCells(db, userId, loadFx(db)).filter((c) => scope(c.accountId, c.tagId));
  const values = new Map<AssetClass, Decimal>();
  const byInstrument = new Map<string, { value: Decimal; quantity: Decimal; cell: (typeof cells)[number] }>();
  for (const c of cells) {
    values.set(c.assetClass, (values.get(c.assetClass) ?? new Decimal(0)).plus(c.valueRub));
    if (c.isCash || !c.priceRub || c.quantity.lte(0)) continue;
    const h = byInstrument.get(c.instrumentId);
    byInstrument.set(c.instrumentId, {
      value: (h?.value ?? new Decimal(0)).plus(c.valueRub),
      quantity: (h?.quantity ?? new Decimal(0)).plus(c.quantity),
      cell: c,
    });
  }
  const lots = new Map(
    byInstrument.size
      ? db
          .select({ id: instruments.id, lot: instruments.lot })
          .from(instruments)
          .all()
          .filter((i) => byInstrument.has(i.id))
          .map((i) => [i.id, new Decimal(i.lot)])
      : [],
  );
  const candidates = new Map<AssetClass, Candidate>();
  for (const [id, h] of byInstrument) {
    const current = candidates.get(h.cell.assetClass);
    const value = h.value;
    if (current && current.price.times(current.quantity).gte(value)) continue;
    candidates.set(h.cell.assetClass, {
      instrumentId: id,
      ticker: h.cell.ticker,
      name: h.cell.name,
      kind: h.cell.kind,
      price: h.cell.priceRub!,
      lot: lots.get(id) ?? new Decimal(1),
      quantity: h.quantity,
    });
  }
  const last = db
    .select({ at: rebalancePlans.createdAt })
    .from(rebalancePlans)
    .where(eq(rebalancePlans.portfolioId, portfolioId))
    .orderBy(desc(rebalancePlans.createdAt))
    .get();
  return { portfolio, values, targets: portfolio.targets, candidates, lastPlanAt: last?.at ?? null };
}

export function planFor(base: RebalanceBase, input: Omit<RebalanceInput, 'values' | 'targets'>) {
  const plan = rebalance({ ...input, values: base.values, targets: base.targets });
  return { plan, orders: ordersFor(plan, base.candidates) };
}
