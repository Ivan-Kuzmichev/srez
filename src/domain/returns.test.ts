import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { excessPp, priceReturn, twr, xirr } from './returns';

const d = (v: string | number) => new Decimal(v);
const pct = (r: Decimal | null | undefined, digits: number) => (r ? r.times(100).toFixed(digits) : null);

describe('XIRR (04, section 4)', () => {
  it('reference 4.1: −100 000, +110 000 a year later is 10,00 %', () => {
    const r = xirr([
      { date: '2025-01-01', amount: d(-100_000) },
      { date: '2026-01-01', amount: d(110_000) },
    ]);
    expect(pct(r?.rate, 2)).toBe('10.00');
    expect(r?.shortPeriod).toBe(false);
  });

  it('reference 4.2: two contributions and the value at the end is 10,0527 %', () => {
    const r = xirr([
      { date: '2025-01-01', amount: d(-1000) },
      { date: '2025-07-01', amount: d(-1000) },
      { date: '2026-01-01', amount: d(2150) },
    ]);
    expect(pct(r?.rate, 4)).toBe('10.0527');
  });

  it('is null for too few flows, one day, or one sign; marks a short period', () => {
    expect(xirr([{ date: '2025-01-01', amount: d(-1) }])).toBeNull();
    expect(
      xirr([
        { date: '2025-01-01', amount: d(-1) },
        { date: '2025-01-01', amount: d(2) },
      ]),
    ).toBeNull();
    expect(
      xirr([
        { date: '2025-01-01', amount: d(-1) },
        { date: '2025-06-01', amount: d(-2) },
      ]),
    ).toBeNull();
    const short = xirr([
      { date: '2025-01-01', amount: d(-1000) },
      { date: '2025-07-01', amount: d(1050) },
    ]);
    expect(short?.shortPeriod).toBe(true);
    expect(Number(pct(short?.rate, 2))).toBeGreaterThan(10);
  });

  it('handles a loss, sums flows of one day, and stays fast on a long daily history', () => {
    expect(
      pct(
        xirr([
          { date: '2025-01-01', amount: d(-1000) },
          { date: '2026-01-01', amount: d(500) },
        ])?.rate,
        2,
      ),
    ).toBe('-50.00');
    expect(
      pct(
        xirr([
          { date: '2025-01-01', amount: d(-60_000) },
          { date: '2025-01-01', amount: d(-40_000) },
          { date: '2026-01-01', amount: d(110_000) },
        ])?.rate,
        2,
      ),
    ).toBe('10.00');
    const flows = Array.from({ length: 2000 }, (_, i) => ({
      date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      amount: d(-100),
    }));
    flows.push({ date: '2025-08-01', amount: d(230_000) });
    const started = Date.now();
    expect(xirr(flows)).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('TWR (04, section 5)', () => {
  it('reference 5.1: 0,4950 %', () => {
    const r = twr([
      { value: d(100_000), flow: d(0) },
      { value: d(101_000), flow: d(0) },
      { value: d(151_500), flow: d(50_000) },
      { value: d(150_000), flow: d(0) },
    ]);
    expect(pct(r, 4)).toBe('0.4950');
  });

  it('starts afresh after a zero value and is null without a start', () => {
    expect(
      pct(
        twr([
          { value: d(0), flow: d(0) },
          { value: d(1100), flow: d(1000) },
          { value: d(1210), flow: d(0) },
        ]),
        2,
      ),
    ).toBe('21.00');
    expect(twr([{ value: d(100), flow: d(0) }])).toBeNull();
    expect(twr([])).toBeNull();
  });

  it('compares with a benchmark in percentage points', () => {
    expect(priceReturn(d(100), d(115))?.toString()).toBe('0.15');
    expect(priceReturn(d(0), d(1))).toBeNull();
    expect(excessPp(d('0.182'), d('0.151'))?.toString()).toBe('3.1');
    expect(excessPp(null, d(1))).toBeNull();
  });
});
