import { Decimal } from './decimal';

/** Rate search needs many powers; 20 digits are plenty for a rate shown with two decimals. */
const R = Decimal.clone({ precision: 20 });
type R = InstanceType<typeof R>;

const DAY_MS = 86_400_000;

export interface CashFlow {
  /** «YYYY-MM-DD» */
  date: string;
  /** Investor's view: money put in is negative, money taken out (and the value at the end) positive. */
  amount: Decimal;
}

export interface Xirr {
  /** Annual rate, 0.1 = 10 %. */
  rate: Decimal;
  /** The flows span less than a year: the annual figure is an extrapolation (docs/04, section 4). */
  shortPeriod: boolean;
}

const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;

/**
 * XIRR (docs/04-calculations.md, section 4): Σ CF_i / (1 + r)^((d_i − d_0) / 365) = 0.
 * Newton from 0.1, bisection on [−0.99; 10] when it does not converge. Null for fewer than two
 * flows, a period shorter than a day, or flows of one sign.
 */
export function xirr(flows: readonly CashFlow[]): Xirr | null {
  const byDay = new Map<string, Decimal>();
  for (const f of flows) byDay.set(f.date, (byDay.get(f.date) ?? new Decimal(0)).plus(f.amount));
  const list = [...byDay].filter(([, a]) => !a.isZero()).sort(([a], [b]) => a.localeCompare(b));
  if (list.length < 2) return null;
  const first = list[0]![0];
  const span = days(first, list.at(-1)![0]);
  if (span < 1) return null;
  if (!list.some(([, a]) => a.lt(0)) || !list.some(([, a]) => a.gt(0))) return null;
  const terms = list.map(([d, a]) => ({ t: new R(days(first, d)).div(365), a: new R(a.toString()) }));

  const npv = (r: R) => {
    const base = r.plus(1);
    let value = new R(0);
    let slope = new R(0);
    for (const { t, a } of terms) {
      const disc = base.pow(t);
      value = value.plus(a.div(disc));
      slope = slope.minus(a.times(t).div(disc.times(base)));
    }
    return { value, slope };
  };

  const done = (r: R) => ({ rate: new Decimal(r.toString()), shortPeriod: span < 365 });
  const tolerance = new R('1e-12');

  let r = new R('0.1');
  for (let i = 0; i < 50; i++) {
    const { value, slope } = npv(r);
    if (value.abs().lt(tolerance)) return done(r);
    if (slope.isZero()) break;
    const next = r.minus(value.div(slope));
    if (!next.isFinite() || next.lte(-0.99) || next.gt(10)) break;
    if (next.minus(r).abs().lt('1e-14')) return done(next);
    r = next;
  }

  let lo = new R('-0.99');
  let hi = new R(10);
  let fLo = npv(lo).value;
  if (fLo.isZero()) return done(lo);
  if (fLo.times(npv(hi).value).gt(0)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = lo.plus(hi).div(2);
    const f = npv(mid).value;
    if (f.abs().lt(tolerance) || hi.minus(lo).lt('1e-14')) return done(mid);
    if (f.times(fLo).lt(0)) hi = mid;
    else {
      lo = mid;
      fLo = f;
    }
  }
  return done(lo.plus(hi).div(2));
}

export interface TwrDay {
  /** Value at the end of the day. */
  value: Decimal;
  /** External flow of the day, inflow positive. */
  flow: Decimal;
}

/**
 * TWR (docs/04-calculations.md, section 5): r_t = (V_t − F_t) / V_{t−1} − 1, chained.
 * A day after a zero value starts afresh: r_t = V_t / F_t − 1. Null without a starting value.
 */
export function twr(series: readonly TwrDay[]): Decimal | null {
  let growth = new Decimal(1);
  let previous: Decimal | null = null;
  let counted = false;
  for (const day of series) {
    if (previous === null) {
      previous = day.value;
      continue;
    }
    let r: Decimal | null = null;
    if (previous.gt(0)) r = day.value.minus(day.flow).div(previous).minus(1);
    else if (day.flow.gt(0)) r = day.value.div(day.flow).minus(1);
    if (r !== null) {
      growth = growth.times(r.plus(1));
      counted = true;
    }
    previous = day.value;
  }
  return counted ? growth.minus(1) : null;
}

/** A benchmark over the same dates: P_end / P_start − 1. */
export function priceReturn(start: Decimal, end: Decimal): Decimal | null {
  return start.gt(0) ? end.div(start).minus(1) : null;
}

/** Portfolio TWR minus the benchmark, in percentage points. */
export function excessPp(portfolio: Decimal | null, benchmark: Decimal | null): Decimal | null {
  return portfolio === null || benchmark === null ? null : portfolio.minus(benchmark).times(100);
}

/**
 * Cumulative TWR growth per day: 1 on the first day, then × (1 + r_t). The return between any two
 * days is G_b / G_a − 1, which is how a chart rebases to its period. Days before money arrives stay 1.
 */
export function twrGrowth(series: readonly TwrDay[]): Decimal[] {
  const out: Decimal[] = [];
  let growth = new Decimal(1);
  let previous: Decimal | null = null;
  for (const day of series) {
    if (previous !== null) {
      if (previous.gt(0)) growth = growth.times(day.value.minus(day.flow).div(previous));
      else if (day.flow.gt(0)) growth = growth.times(day.value.div(day.flow));
    }
    out.push(growth);
    previous = day.value;
  }
  return out;
}
