import { describe, expect, it } from 'vitest';
import { bondArea, bondMetrics, type BondFlow } from './bonds';
import { Decimal } from './decimal';

const D = (v: string | number) => new Decimal(v);
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = '2026-10-09';
// Coupons, then the nominal as its own flow on the last date (as payout_events store them).
const schedule = (coupon: string, count: number, nominal: string, estimateFrom = Infinity): BondFlow[] => [
  ...Array.from({ length: count }, (_, i) => ({
    date: addDays(today, 182 * (i + 1)),
    amount: D(coupon),
    estimate: i >= estimateFrom,
  })),
  { date: addDays(today, 182 * count), amount: D(nominal) },
];

describe('эталон 12.1: доходность и дюрация выпуска', () => {
  it('12,99 %, Macaulay 7,95, modified 7,04', () => {
    const m = bondMetrics({
      today,
      cleanPrice: D('634.00'),
      aci: D(0),
      flows: schedule('35.40', 30, '1000'),
      floating: false,
      currentCoupon: D('35.40'),
    });
    expect(m.ytm!.times(100).toFixed(2)).toBe('12.99');
    expect(m.duration!.toFixed(2)).toBe('7.95');
    expect(m.modified!.toFixed(2)).toBe('7.04');
    expect(m.approx).toBe(false);
  });
});

describe('эталон 12.2: по области', () => {
  it('weighted yield 13,63 %, duration 5,87, −75 563 for +1 p.p.', () => {
    const rows = [
      [646680, 12.8, 7.4],
      [221320, 15.0, 0.1],
      [217760, 12.9, 6.9],
      [201000, 15.6, 6.2],
    ].map(([v, y, d]) => ({ value: D(v!), ytm: D(y!).div(100), duration: D(d!), modified: D(d!) }));
    const a = bondArea(rows, D('0.01'));
    expect(a.ytm!.times(100).toFixed(2)).toBe('13.63');
    expect(a.duration!.toFixed(2)).toBe('5.87');
    expect(a.shock.round().toFixed()).toBe('-75563');
    expect(a.value.toFixed()).toBe('1286760');
  });
});

describe('bond edge cases', () => {
  it('a floater: coupons not fixed yet are the current one, duration to the next coupon', () => {
    const m = bondMetrics({
      today,
      cleanPrice: D('1006'),
      aci: D('10'),
      flows: schedule('0', 20, '1000', 1).map((f, i) => (i === 0 ? { ...f, amount: D('40') } : f)),
      floating: true,
      currentCoupon: D('40'),
    });
    expect(m.approx).toBe(true);
    expect(m.duration!.toFixed(2)).toBe('0.50');
    expect(m.ytm!.times(100).toNumber()).toBeGreaterThan(7);
  });

  it('nothing left to pay or no price gives nothing', () => {
    const base = { today, aci: D(0), floating: false, currentCoupon: null };
    expect(bondMetrics({ ...base, cleanPrice: D(900), flows: [] }).ytm).toBeNull();
    expect(bondMetrics({ ...base, cleanPrice: D(0), flows: schedule('30', 2, '1000') }).ytm).toBeNull();
  });

  it('bonds without a yield are left out of the averages', () => {
    const a = bondArea(
      [
        { value: D(100), ytm: D('0.1'), duration: D(2), modified: D(2) },
        { value: D(100), ytm: null, duration: null, modified: null },
      ],
      D('0.01'),
    );
    expect(a.ytm!.toFixed(2)).toBe('0.10');
    expect(a.value.toFixed()).toBe('200');
    expect(a.shock.toFixed()).toBe('-2');
  });
});
