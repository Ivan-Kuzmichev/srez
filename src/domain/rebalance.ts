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
