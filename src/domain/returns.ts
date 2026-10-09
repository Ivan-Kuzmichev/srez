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
 * Newton from a float-found start, bisection on [−0.99; 10] when it does not converge. Null for fewer than two
 * flows, a period shorter than a day, or flows of one sign.
 */
export function xirr(flows: readonly CashFlow[]): Xirr | null {
  const prepared = prepare(flows);
  if (!prepared) return null;
  // Owner's decision (phase 10): a float search only picks where Decimal starts; the answer is
  // Decimal's. From a close start Decimal Newton needs one or two steps instead of a dozen.
  const seed = floatSeed(prepared.terms.map(({ t, a }) => ({ t: t.toNumber(), a: a.toNumber() })));
  return solve(prepared.terms, seed === null ? '0.1' : String(seed), prepared.span);
}

/** XIRR from a given start, with no float help: the Decimal path itself, for tests. */
export function xirrFrom(flows: readonly CashFlow[], start: string): Xirr | null {
  const prepared = prepare(flows);
  return prepared && solve(prepared.terms, start, prepared.span);
}

function prepare(flows: readonly CashFlow[]): { terms: { t: R; a: R }[]; span: number } | null {
  const byDay = new Map<string, Decimal>();
  for (const f of flows) byDay.set(f.date, (byDay.get(f.date) ?? new Decimal(0)).plus(f.amount));
  const list = [...byDay].filter(([, a]) => !a.isZero()).sort(([a], [b]) => a.localeCompare(b));
  if (list.length < 2) return null;
  const first = list[0]![0];
  const span = days(first, list.at(-1)![0]);
  if (span < 1) return null;
  if (!list.some(([, a]) => a.lt(0)) || !list.some(([, a]) => a.gt(0))) return null;
  return {
    terms: list.map(([d, a]) => ({ t: new R(days(first, d)).div(365), a: new R(a.toString()) })),
    span,
  };
}

/** Decimal Newton from `start`, bisection on [−0.99; 10] when it does not converge. */
function solve(terms: { t: R; a: R }[], start: string, span: number): Xirr | null {
  const done = (r: R) => ({ rate: new Decimal(r.toString()), shortPeriod: span < 365 });
  // Relative to the money moved: with millions in flows an absolute 1e-12 is past 20 digits.
  const tolerance = terms.reduce((sum, { a }) => sum.plus(a.abs()), new R(0)).times('1e-12');
  const npv = (r: R) => {
    const base = r.plus(1);
    // (1 + r)^t = e^(t·ln(1 + r)): the logarithm once per evaluation, not once per flow.
    const ln = base.ln();
    let value = new R(0);
    let slope = new R(0);
    for (const { t, a } of terms) {
      const disc = t.times(ln).exp();
      value = value.plus(a.div(disc));
      slope = slope.minus(a.times(t).div(disc.times(base)));
    }
    return { value, slope };
  };
  let r = new R(start);
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

/** A rate close to the root, in plain numbers; null when no root shows up between −0.99 and 10. */
function floatSeed(terms: readonly { t: number; a: number }[]): number | null {
  const npv = (r: number) => {
    let value = 0;
    let slope = 0;
    for (const { t, a } of terms) {
      const disc = Math.pow(1 + r, t);
      value += a / disc;
      slope -= (a * t) / (disc * (1 + r));
    }
    return { value, slope };
  };
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const { value, slope } = npv(r);
    if (!Number.isFinite(value) || slope === 0) break;
    const next = r - value / slope;
    if (!Number.isFinite(next) || next <= -0.99 || next > 10) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo).value;
  if (!Number.isFinite(fLo) || fLo * npv(hi).value > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid).value;
    if (f * fLo < 0) hi = mid;
    else {
      lo = mid;
      fLo = f;
    }
  }
  return (lo + hi) / 2;
}
