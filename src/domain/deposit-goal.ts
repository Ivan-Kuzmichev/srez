import { Decimal } from './decimal';

/** docs/04-calculations.md, section 18: «Цель пополнений» of a portfolio. */
export type DepositPeriod = 'day' | 'month' | 'year';

export interface DepositGoal {
  /** Rubles a period. */
  amount: Decimal;
  period: DepositPeriod;
  /** The month (1–12) a goal year starts with. */
  yearStart: number;
}

export interface DayDeposit {
  /** «YYYY-MM-DD» in the display time zone. */
  date: string;
  /** Rubles. */
  amount: Decimal;
}

/** A cell against its goal: 0 nothing, 1 under half, 2 half or more, 3 the goal reached. */
export type DepositLevel = 0 | 1 | 2 | 3;

export interface DepositCell {
  /** The first day of the month, or the day. */
  date: string;
  amount: Decimal;
  level: DepositLevel;
  state: 'past' | 'current' | 'future';
}

export type DepositView =
  | {
      kind: 'year';
      from: string;
      /** The last day of the goal year. */
      to: string;
      deposited: Decimal;
      /** What is left to the goal, never below zero. */
      left: Decimal;
      /** The part of the year gone, today included: where the even pace stands. */
      elapsed: number;
      /** The even pace minus what was deposited: + behind, − ahead. */
      behind: Decimal;
      /** Twelve equal slices of the goal, how full each is (0–1). */
      slices: number[];
    }
  | {
      kind: 'month';
      cells: DepositCell[];
      /** Months that reached the goal, of the months gone (the current one once it reached it). */
      met: number;
      counted: number;
      /** Deposited in the goal year to date. */
      total: Decimal;
    }
  | {
      kind: 'day';
      /** «YYYY-MM-01» of the current month. */
      month: string;
      cells: DepositCell[];
      met: number;
      counted: number;
      total: Decimal;
      /** The goal of the counted days. */
      due: Decimal;
    }
  | {
      /** No goal: the months of the year, each against the largest of them. */
      kind: 'none';
      cells: DepositCell[];
      total: Decimal;
    };

const ZERO = new Decimal(0);

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** The goal year holding `today`: from the first of `yearStart` to the day before it a year on. */
export function goalYear(today: string, yearStart: number): { from: string; to: string } {
  const [y, m] = parts(today);
  const startYear = m >= yearStart ? y : y - 1;
  const endMonth = yearStart === 1 ? 12 : yearStart - 1;
  const endYear = yearStart === 1 ? startYear : startYear + 1;
  return { from: ymd(startYear, yearStart, 1), to: ymd(endYear, endMonth, daysIn(endYear, endMonth)) };
}

/** The twelve months of the goal year, «YYYY-MM-01». */
function monthsOf(from: string): string[] {
  const [y, m] = parts(from);
  return Array.from({ length: 12 }, (_, i) => {
    const k = m - 1 + i;
    return ymd(y + Math.floor(k / 12), (k % 12) + 1, 1);
  });
}

export function levelOf(amount: Decimal, goal: Decimal): DepositLevel {
  if (amount.lte(0) || goal.lte(0)) return 0;
  if (amount.gte(goal)) return 3;
  return amount.times(2).gte(goal) ? 2 : 1;
}

function sumBy(deposits: readonly DayDeposit[], key: (date: string) => string): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const d of deposits) out.set(key(d.date), (out.get(key(d.date)) ?? ZERO).plus(d.amount));
  return out;
}

const monthKey = (date: string) => `${date.slice(0, 7)}-01`;
const stateOf = (key: string, current: string): DepositCell['state'] =>
  key < current ? 'past' : key === current ? 'current' : 'future';

/**
 * The widget of a goal on `today`: a year in twelve slices, the months of the goal year, or the days
 * of the current month. A period is on plan when its deposits reach the goal; the current one is
 * counted once it did, so a month just begun does not count against the owner.
 */
export function depositView(
  deposits: readonly DayDeposit[],
  goal: DepositGoal | null,
  today: string,
  /** Without a goal: the month its year would start with. */
  yearStart = goal?.yearStart ?? 1,
): DepositView {
  const year = goalYear(today, yearStart);
  const inYear = deposits.filter((d) => d.date >= year.from && d.date <= today);
  const total = inYear.reduce((s, d) => s.plus(d.amount), ZERO);

  if (!goal || goal.period === 'month') {
    const byMonth = sumBy(inYear, monthKey);
    const current = monthKey(today);
    const largest = [...byMonth.values()].reduce((m, v) => Decimal.max(m, v), ZERO);
    const cells = monthsOf(year.from).map((date) => {
      const amount = byMonth.get(date) ?? ZERO;
      return { date, amount, level: levelOf(amount, goal?.amount ?? largest), state: stateOf(date, current) };
    });
    if (!goal) return { kind: 'none', cells, total };
    const counted = cells.filter((c) => c.state === 'past' || (c.state === 'current' && c.level === 3));
    return {
      kind: 'month',
      cells,
      met: counted.filter((c) => c.level === 3).length,
      counted: counted.length,
      total,
    };
  }

  if (goal.period === 'day') {
    const [y, m] = parts(today);
    const month = ymd(y, m, 1);
    const byDay = sumBy(
      deposits.filter((d) => d.date >= month && d.date <= today),
      (d) => d,
    );
    const cells = Array.from({ length: daysIn(y, m) }, (_, i) => {
      const date = ymd(y, m, i + 1);
      const amount = byDay.get(date) ?? ZERO;
      return { date, amount, level: levelOf(amount, goal.amount), state: stateOf(date, today) };
    });
    const counted = cells.filter((c) => c.state === 'past' || (c.state === 'current' && c.level === 3));
    return {
      kind: 'day',
      month,
      cells,
      met: counted.filter((c) => c.level === 3).length,
      counted: counted.length,
      total: [...byDay.values()].reduce((s, v) => s.plus(v), ZERO),
      due: goal.amount.times(counted.length),
    };
  }

  const days = dayNumber(year.to) - dayNumber(year.from) + 1;
  const elapsed = (dayNumber(today) - dayNumber(year.from) + 1) / days;
  const slice = goal.amount.div(12);
  return {
    kind: 'year',
    from: year.from,
    to: year.to,
    deposited: total,
    left: Decimal.max(0, goal.amount.minus(total)),
    elapsed,
    behind: goal.amount.times(elapsed).minus(total),
    slices: Array.from({ length: 12 }, (_, i) =>
      slice.isZero() ? 0 : Decimal.min(1, Decimal.max(0, total.minus(slice.times(i)).div(slice))).toNumber(),
    ),
  };
}

/** Monday first: the empty cells before the first day of a month. */
export function leadingBlanks(month: string): number {
  return (new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % 7;
}
