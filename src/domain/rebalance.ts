import type { AssetClass } from './allocation';
import { Decimal } from './decimal';

/** docs/04-calculations.md, section 8. */
export interface RebalanceInput {
  /** Current value per class, rubles. */
  values: Map<AssetClass, Decimal>;
  /** Target shares in percent; classes without a target count as 0. */
  targets: Map<AssetClass, Decimal>;
  /** The contribution A. */
  contribution: Decimal;
  mode: 'buy-only' | 'buy-sell';
  /** «Пустить в дело кэш сверх цели». */
  useExcessCash: boolean;
  /** Rounding step of the amounts, rubles. */
  step?: Decimal;
}

export interface ClassPlan {
  assetClass: AssetClass;
  before: Decimal;
  beforeShare: Decimal;
  target: Decimal;
  /** Positive buys, negative sells. */
  trade: Decimal;
  after: Decimal;
  afterShare: Decimal;
  /** after share − target, percentage points. */
  deviation: Decimal;
}

export interface RebalancePlan {
  classes: ClassPlan[];
  excessCash: Decimal;
  budget: Decimal;
  /** Budget the deficits did not take: it stays as cash. */
  leftover: Decimal;
  maxDeviationBefore: Decimal;
  maxDeviationAfter: Decimal;
}

const ZERO = new Decimal(0);

/**
 * Rounds amounts to `step` so that they still sum to `total` (largest remainder): everything is
 * rounded down, then the steps that are left go to the largest fractional parts.
 */
export function roundToStep(amounts: Decimal[], total: Decimal, step: Decimal): Decimal[] {
  const units = amounts.map((a) => a.div(step));
  const floors = units.map((u) => u.floor());
  let left = total
    .div(step)
    .round()
    .minus(floors.reduce((s, f) => s.plus(f), ZERO))
    .toNumber();
  const order = units
    .map((u, i) => ({ i, frac: u.minus(u.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--)
    floors[order[k]!.i] = floors[order[k]!.i]!.plus(1);
  return floors.map((f) => f.times(step));
}

export function rebalance(input: RebalanceInput): RebalancePlan {
  const step = input.step ?? new Decimal(100);
  const classes = [...new Set([...input.values.keys(), ...input.targets.keys()])];
  const v = (c: AssetClass) => input.values.get(c) ?? ZERO;
  const t = (c: AssetClass) => (input.targets.get(c) ?? ZERO).div(100);
  const total = classes.reduce((s, c) => s.plus(v(c)), ZERO);
  const after = total.plus(input.contribution);
  const excessCash = Decimal.max(0, v('cash').minus(t('cash').times(after)));
  const budget = input.contribution.plus(input.useExcessCash ? excessCash : ZERO);

  const trades = new Map<AssetClass, Decimal>();
  let leftover = ZERO;
  if (input.mode === 'buy-only') {
    // Buy the classes below target in proportion to the gap, never past it; cash pays.
    const short = classes.filter((c) => c !== 'cash');
    const deficits = short.map((c) => Decimal.max(0, t(c).times(after).minus(v(c))));
    const sum = deficits.reduce((s, d) => s.plus(d), ZERO);
    // Never past the budget: the total goes down to the step, the rest stays as cash.
    const spend = Decimal.min(budget, sum).div(step).floor().times(step);
    const raw = deficits.map((d) => (sum.isZero() ? ZERO : Decimal.min(d, budget.times(d).div(sum))));
    const buys = roundToStep(raw, spend, step);
    short.forEach((c, i) => trades.set(c, buys[i]!));
    const spent = buys.reduce((s, b) => s.plus(b), ZERO);
    leftover = budget.minus(spent);
    // The contribution lands in cash and the purchases are paid from it.
    trades.set('cash', input.contribution.minus(spent));
  } else {
    // Every class to its target; the trades add up to the contribution.
    const raw = classes.map((c) => t(c).times(after).minus(v(c)));
    const rounded = roundToStep(raw, input.contribution, step);
    classes.forEach((c, i) => trades.set(c, rounded[i]!));
  }

  const result: ClassPlan[] = classes.map((c) => {
    const trade = trades.get(c) ?? ZERO;
    const value = v(c).plus(trade);
    const beforeShare = total.isZero() ? ZERO : v(c).div(total).times(100);
    const afterShare = after.isZero() ? ZERO : value.div(after).times(100);
    return {
      assetClass: c,
      before: v(c),
      beforeShare,
      target: t(c).times(100),
      trade,
      after: value,
      afterShare,
      deviation: afterShare.minus(t(c).times(100)),
    };
  });
  const maxBefore = result.reduce((m, r) => Decimal.max(m, r.beforeShare.minus(r.target).abs()), ZERO);
  const maxAfter = result.reduce((m, r) => Decimal.max(m, r.deviation.abs()), ZERO);
  return {
    classes: result,
    excessCash,
    budget,
    leftover,
    maxDeviationBefore: maxBefore,
    maxDeviationAfter: maxAfter,
  };
}

/** Lots for an amount at a price: the nearest whole number of lots (section 8). */
export function lotsFor(amount: Decimal, price: Decimal, lot: Decimal): Decimal {
  if (price.lte(0) || lot.lte(0)) return ZERO;
  return amount.abs().div(price.times(lot)).round().times(lot);
}

/** The position a class trade goes into: the largest one of that class in the portfolio. */
export interface Candidate {
  instrumentId: string;
  ticker: string | null;
  name: string;
  kind: string;
  /** Rubles per unit now. */
  price: Decimal;
  lot: Decimal;
  /** Held in the portfolio, for sales. */
  quantity: Decimal;
}

export interface Order {
  assetClass: AssetClass;
  instrumentId: string;
  ticker: string | null;
  name: string;
  kind: string;
  side: 'buy' | 'sell';
  quantity: Decimal;
  price: Decimal;
  amount: Decimal;
}

/** Whole lots for each class trade, at the current price; sales never exceed the holding. */
export function ordersFor(plan: RebalancePlan, candidates: Map<AssetClass, Candidate>): Order[] {
  const out: Order[] = [];
  for (const c of [...plan.classes].sort((a, b) => b.trade.abs().comparedTo(a.trade.abs()))) {
    if (c.assetClass === 'cash' || c.trade.isZero()) continue;
    const cand = candidates.get(c.assetClass);
    if (!cand) continue;
    let quantity = lotsFor(c.trade, cand.price, cand.lot);
    if (c.trade.lt(0)) quantity = Decimal.min(quantity, cand.quantity);
    if (quantity.isZero()) continue;
    out.push({
      assetClass: c.assetClass,
      instrumentId: cand.instrumentId,
      ticker: cand.ticker,
      name: cand.name,
      kind: cand.kind,
      side: c.trade.gt(0) ? 'buy' : 'sell',
      quantity,
      price: cand.price,
      amount: quantity.times(cand.price),
    });
  }
  return out;
}

/** The equity part of a plan spread over sectors (FR-PRT-10, docs/04 section 8). */
export interface SectorInput {
  /** Value of the shares and funds per sector code ('' unknown), rubles. */
  values: Map<string, Decimal>;
  /** Target shares of the shares and funds, percent; sectors without one have none. */
  targets: Map<string, Decimal>;
  /** What the class plan buys (+) or sells (−) of shares and funds together. */
  trade: Decimal;
  mode: 'buy-only' | 'buy-sell';
  step?: Decimal;
}

export interface SectorPlan {
  sector: string;
  before: Decimal;
  beforeShare: Decimal;
  target: Decimal | null;
  trade: Decimal;
  after: Decimal;
  afterShare: Decimal;
  /** after share − target, percentage points; null without a target. */
  deviation: Decimal | null;
}

/**
 * Splits the shares-and-funds trade over sectors. Buying only: the sectors below target get it in
 * proportion to the gap, never past it; what is left goes to the sectors without a target by value
 * (or, with none, to the targeted ones by target). Buying and selling: each targeted sector to its
 * target, the rest by value. Amounts are rounded to the step and still add up to the trade.
 */
export function sectorRebalance(input: SectorInput): SectorPlan[] {
  const step = input.step ?? new Decimal(100);
  const sectors = [...new Set([...input.values.keys(), ...input.targets.keys()])];
  const v = (s: string) => input.values.get(s) ?? ZERO;
  const target = (s: string) => input.targets.get(s) ?? null;
  const before = sectors.reduce((sum, s) => sum.plus(v(s)), ZERO);
  const after = before.plus(input.trade);
  const goal = (s: string) => target(s)!.div(100).times(after).minus(v(s));
  const targeted = sectors.filter((s) => target(s) !== null);
  const free = sectors.filter((s) => target(s) === null);

  const raw = new Map<string, Decimal>(sectors.map((s) => [s, ZERO]));
  let left = input.trade;
  if (input.mode === 'buy-only') {
    const gaps = targeted.map((s) => Decimal.max(0, goal(s)));
    const sum = gaps.reduce((a, g) => a.plus(g), ZERO);
    targeted.forEach((s, i) => {
      const share = sum.isZero() ? ZERO : Decimal.min(gaps[i]!, input.trade.times(gaps[i]!).div(sum));
      raw.set(s, Decimal.max(0, share));
    });
    left = input.trade.minus(targeted.reduce((a, s) => a.plus(raw.get(s)!), ZERO));
  } else {
    for (const s of targeted) raw.set(s, goal(s));
    left = input.trade.minus(targeted.reduce((a, s) => a.plus(raw.get(s)!), ZERO));
  }
  // What the targets did not take: by value to the free sectors, else by target to the targeted.
  const freeValue = free.reduce((a, s) => a.plus(v(s)), ZERO);
  const pool = freeValue.gt(0) ? free : targeted;
  const weight = (s: string) => (freeValue.gt(0) ? v(s) : (target(s) ?? ZERO));
  const weights = pool.reduce((a, s) => a.plus(weight(s)), ZERO);
  if (!left.isZero() && weights.gt(0))
    for (const s of pool) raw.set(s, raw.get(s)!.plus(left.times(weight(s)).div(weights)));

  const rounded = roundToStep(
    sectors.map((s) => raw.get(s)!),
    input.trade,
    step,
  );
  return sectors
    .map((s, i): SectorPlan => {
      const trade = rounded[i]!;
      const value = v(s).plus(trade);
      const afterShare = after.isZero() ? ZERO : value.div(after).times(100);
      const t = target(s);
      return {
        sector: s,
        before: v(s),
        beforeShare: before.isZero() ? ZERO : v(s).div(before).times(100),
        target: t,
        trade,
        after: value,
        afterShare,
        deviation: t === null ? null : afterShare.minus(t),
      };
    })
    .sort((a, b) => b.trade.comparedTo(a.trade));
}

/** A sector trade with nothing of the sector held: the owner picks the security. */
export interface SectorGap {
  sector: string;
  amount: Decimal;
}

/**
 * Orders for the sector trades: into the largest held position of each sector, whole lots. A sector
 * with a trade and no position comes back as a gap instead.
 */
export function sectorOrders(
  plans: readonly SectorPlan[],
  candidates: Map<string, Candidate & { assetClass: AssetClass }>,
): { orders: Order[]; gaps: SectorGap[] } {
  const orders: Order[] = [];
  const gaps: SectorGap[] = [];
  for (const p of plans) {
    if (p.trade.isZero()) continue;
    const cand = candidates.get(p.sector);
    if (!cand) {
      if (p.trade.gt(0)) gaps.push({ sector: p.sector, amount: p.trade });
      continue;
    }
    let quantity = lotsFor(p.trade, cand.price, cand.lot);
    if (p.trade.lt(0)) quantity = Decimal.min(quantity, cand.quantity);
    if (quantity.isZero()) continue;
    orders.push({
      assetClass: cand.assetClass,
      instrumentId: cand.instrumentId,
      ticker: cand.ticker,
      name: cand.name,
      kind: cand.kind,
      side: p.trade.gt(0) ? 'buy' : 'sell',
      quantity,
      price: cand.price,
      amount: quantity.times(cand.price),
    });
  }
  return { orders, gaps };
}

/**
 * Orders of a plan: by class, or, with sectors on, the shares and funds by sector instead (their
 * class trade split by `sectorRebalance`). The calculator and «Сохранить как план» both use it.
 */
export function ordersWithSectors(
  plan: RebalancePlan,
  classCandidates: Map<AssetClass, Candidate>,
  sectors: {
    values: Map<string, Decimal>;
    targets: Map<string, Decimal>;
    candidates: Map<string, Candidate & { assetClass: AssetClass }>;
    mode: 'buy-only' | 'buy-sell';
    step?: Decimal;
  } | null,
): { orders: Order[]; sectors: SectorPlan[]; gaps: SectorGap[] } {
  if (!sectors || sectors.targets.size === 0)
    return { orders: ordersFor(plan, classCandidates), sectors: [], gaps: [] };
  const equity = (c: ClassPlan) => c.assetClass === 'stocks' || c.assetClass === 'funds';
  const trade = plan.classes.filter(equity).reduce((s, c) => s.plus(c.trade), ZERO);
  const sectorPlans = sectorRebalance({ ...sectors, trade });
  const rest = ordersFor({ ...plan, classes: plan.classes.filter((c) => !equity(c)) }, classCandidates);
  const bySector = sectorOrders(sectorPlans, sectors.candidates);
  return { orders: [...rest, ...bySector.orders], sectors: sectorPlans, gaps: bySector.gaps };
}
