import { Decimal } from './decimal';
import { xirr } from './returns';

/** docs/04-calculations.md, section 12. */
export interface BondFlow {
  /** «YYYY-MM-DD», pay date. */
  date: string;
  /** Per bond, in the price currency. */
  amount: Decimal;
  /** A coupon not fixed yet (a floater) or not announced. */
  estimate?: boolean;
}

export interface BondInput {
  today: string;
  /** Clean price per bond, money. */
  cleanPrice: Decimal;
  /** Accrued interest per bond today. */
  aci: Decimal;
  /** Future coupons and the nominal at maturity, per bond. */
  flows: readonly BondFlow[];
  floating: boolean;
  /** The last known coupon: stands in for coupons not fixed yet. */
  currentCoupon: Decimal | null;
}

export interface BondMetrics {
  /** Effective annual yield to maturity, a fraction. */
  ytm: Decimal | null;
  /** Macaulay duration, years. */
  duration: Decimal | null;
  /** D / (1 + y). */
  modified: Decimal | null;
  /** Some coupons were taken equal to the current one. */
  approx: boolean;
}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const years = (from: string, to: string) =>
  new Decimal(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)).div(365 * 86_400_000);

/**
 * Yield and duration of one bond. Coupons not fixed yet are taken equal to the current one. A
 * floater's duration is the time to its next coupon: the coupon resets, the price barely moves with rates.
 */
export function bondMetrics(input: BondInput): BondMetrics {
  const future = input.flows.filter((f) => f.date > input.today).sort((a, b) => a.date.localeCompare(b.date));
  let approx = input.floating;
  const flows = future.map((f) => {
    if (!f.estimate) return f;
    approx = true;
    return { ...f, amount: input.currentCoupon ?? f.amount };
  });
  const dirty = input.cleanPrice.plus(input.aci);
  if (flows.length === 0 || dirty.lte(0)) return { ytm: null, duration: null, modified: null, approx };
  const solved = xirr([
    { date: input.today, amount: dirty.neg() },
    ...flows.map((f) => ({ date: f.date, amount: f.amount })),
  ]);
  if (!solved) return { ytm: null, duration: null, modified: null, approx };
  const y = solved.rate;
  let duration: Decimal;
  if (input.floating) duration = years(input.today, flows[0]!.date);
  else {
    let pv = ZERO;
    let weighted = ZERO;
    for (const f of flows) {
      const t = years(input.today, f.date);
      const v = f.amount.div(ONE.plus(y).pow(t));
      pv = pv.plus(v);
      weighted = weighted.plus(t.times(v));
    }
    duration = pv.isZero() ? ZERO : weighted.div(pv);
  }
  return { ytm: y, duration, modified: duration.div(ONE.plus(y)), approx };
}

export interface BondHolding {
  /** Rubles. */
  value: Decimal;
  ytm: Decimal | null;
  duration: Decimal | null;
  modified: Decimal | null;
}

/** Value-weighted averages over the bonds that have them, and the price change for a rate move Δ (fraction). */
export function bondArea(holdings: readonly BondHolding[], delta: Decimal) {
  const weighted = (pick: (h: BondHolding) => Decimal | null) => {
    let sum = ZERO;
    let weight = ZERO;
    for (const h of holdings) {
      const v = pick(h);
      if (v === null || h.value.lte(0)) continue;
      sum = sum.plus(v.times(h.value));
      weight = weight.plus(h.value);
    }
    return weight.isZero() ? null : sum.div(weight);
  };
  const shock = holdings.reduce(
    (s, h) => (h.modified === null ? s : s.minus(h.modified.times(delta).times(h.value))),
    ZERO,
  );
  return {
    value: holdings.reduce((s, h) => s.plus(h.value), ZERO),
    ytm: weighted((h) => h.ytm),
    duration: weighted((h) => h.duration),
    shock,
  };
}
