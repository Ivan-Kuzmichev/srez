import { Decimal } from './decimal';
import { valueOn } from './timeline';

/** docs/04-calculations.md, section 15: the same money, the same days, somewhere else. */
export interface WhatIfFlow {
  /** «YYYY-MM-DD» in the display time zone. */
  date: string;
  /** Rubles: + money in, − money out. */
  amount: Decimal;
}

export interface DayValue {
  date: string;
  value: Decimal;
}

const ZERO = new Decimal(0);
const DAYS_A_YEAR = new Decimal(365);

function byDay(flows: readonly WhatIfFlow[]): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const f of flows) out.set(f.date, (out.get(f.date) ?? ZERO).plus(f.amount));
  return out;
}

/**
 * Each deposit buys index units at the day's close, each withdrawal sells them; the value of a day is
 * the units times its close. A day without a close takes the last one before, a flow before the index
 * history the first one. `feePct` a year melts the units day by day, as a fund's fee would.
 */
export function intoIndex(
  flows: readonly WhatIfFlow[],
  closes: readonly { date: string; close: string }[],
  days: readonly string[],
  feePct: Decimal = ZERO,
): DayValue[] {
  // (1 − fee)^(1/365) a day: a year of it takes the fee.
  const keep = new Decimal(1).minus(feePct.div(100)).pow(new Decimal(1).div(DAYS_A_YEAR));
  const sorted = [...closes].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];
  const closeOn = (date: string) => new Decimal((valueOn(sorted, date) ?? sorted[0]!).close);
  const moves = byDay(flows);
  let units = ZERO;
  return days.map((date, i) => {
    const price = closeOn(date);
    if (i > 0 && !feePct.isZero()) units = units.times(keep);
    const amount = moves.get(date);
    if (amount && price.gt(0)) units = units.plus(amount.div(price));
    return { date, value: units.times(price) };
  });
}

/**
 * A deposit: interest accrues every day on the balance the day began with, at that day's annual rate
 * over 365. With `compound` it is added to the balance on the last day of each month; without, it is
 * paid aside and earns nothing (the value still counts it). `days` must be consecutive.
 */
export function intoDeposit(
  flows: readonly WhatIfFlow[],
  ratePct: (date: string) => Decimal,
  days: readonly string[],
  compound = true,
): DayValue[] {
  const moves = byDay(flows);
  let balance = ZERO;
  let accrued = ZERO;
  return days.map((date) => {
    const rate = Decimal.max(0, ratePct(date));
    accrued = accrued.plus(balance.times(rate).div(100).div(DAYS_A_YEAR));
    balance = balance.plus(moves.get(date) ?? ZERO);
    if (compound && lastDayOfMonth(date)) {
      balance = balance.plus(accrued);
      accrued = ZERO;
    }
    return { date, value: balance.plus(accrued) };
  });
}

function lastDayOfMonth(date: string): boolean {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000);
  return next.getUTCDate() === 1;
}
