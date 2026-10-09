import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { interestDates, monthlyInterest, yearForecast } from './payouts';

describe('payouts (04, section 9)', () => {
  it('reference 9.1: received 210 108 and expected 69 860 make 279 968, 23 331 a month', () => {
    const r = yearForecast(new Decimal(210_108), new Decimal(69_860));
    expect(r.forecast.toString()).toBe('279968');
    expect(r.perMonth.toFixed(0)).toBe('23331');
  });

  it('reference 9.2: a deposit of 210 000 at 16 % pays 2 800 a month', () => {
    expect(monthlyInterest(new Decimal(210_000), new Decimal(16)).toString()).toBe('2800');
  });

  it('accrues on the opening day of each month, kept inside short months', () => {
    expect(interestDates('2026-01-31', '2026-01-01', '2026-05-31')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(interestDates('2025-11-02', '2026-10-09', '2026-12-31')).toEqual(['2026-11-02', '2026-12-02']);
    expect(interestDates('2026-10-02', '2026-01-01', '2026-10-09')).toEqual([]);
  });
});
