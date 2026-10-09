import { Decimal } from './decimal';

/** docs/04-calculations.md, section 9: forecast = received since January + expected to December. */
export function yearForecast(received: Decimal, expected: Decimal): { forecast: Decimal; perMonth: Decimal } {
  const forecast = received.plus(expected);
  return { forecast, perMonth: forecast.div(12) };
}

/** A custom asset valued at an annual rate pays value × rate / 12 a month (section 9). */
export function monthlyInterest(value: Decimal, annualRatePct: Decimal): Decimal {
  return value.times(annualRatePct).div(100).div(12);
}

/** «2026-02-31» → «2026-02-28»: the opening day, kept inside short months. */
function onDay(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Monthly accrual dates on the day of the month the asset was opened, after `opened` and
 * within [from, to] (inclusive, «YYYY-MM-DD»).
 */
export function interestDates(opened: string, from: string, to: string): string[] {
  const [y0, m0, d0] = opened.split('-').map(Number) as [number, number, number];
  const out: string[] = [];
  for (let k = 1; k < 1200; k++) {
    const months = m0 - 1 + k;
    const date = onDay(y0 + Math.floor(months / 12), (months % 12) + 1, d0);
    if (date > to) break;
    if (date >= from) out.push(date);
  }
  return out;
}
