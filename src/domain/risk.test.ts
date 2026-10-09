import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { twrGrowth } from './returns';
import {
  beta,
  dailyReturns,
  drawdownSeries,
  largest,
  limitChecks,
  maxDrawdown,
  riskCurrencies,
  volatility,
  worstMonth,
  type Holding,
} from './risk';

const D = (v: string | number) => new Decimal(v);

describe('эталон 11.1: просадка и волатильность', () => {
  const values = [100, 110, 99, 104.5, 120].map(D);
  const index = twrGrowth(values.map((value) => ({ value, flow: D(0) })));
  const points = index.map((v, i) => ({ date: `2026-01-0${i + 1}`, index: v }));

  it('max drawdown −10,00 % on the third day, recovered on the fifth', () => {
    const m = maxDrawdown(points)!;
    expect(m.depth.times(100).toFixed(2)).toBe('-10.00');
    expect(m.peakDate).toBe('2026-01-02');
    expect(m.troughDate).toBe('2026-01-03');
    expect(m.recoveryDate).toBe('2026-01-05');
    expect(m.recoveryDays).toBe(2);
    expect(drawdownSeries(points).map((p) => p.dd.times(100).toFixed(2))).toEqual([
      '0.00',
      '0.00',
      '-10.00',
      '-5.00',
      '0.00',
    ]);
  });

  it('volatility 170,7 % a year', () => {
    expect(volatility(dailyReturns(index))!.times(100).toFixed(1)).toBe('170.7');
  });
});

describe('risk measures', () => {
  it('no drawdown when the index only grows; one still open has no recovery', () => {
    expect(
      maxDrawdown([
        { date: '2026-01-01', index: D(1) },
        { date: '2026-01-02', index: D(1.1) },
      ]),
    ).toBeNull();
    const open = maxDrawdown([
      { date: '2026-01-01', index: D(1) },
      { date: '2026-01-02', index: D(0.8) },
      { date: '2026-01-03', index: D(0.9) },
    ])!;
    expect(open.recoveryDate).toBeNull();
    expect(open.depth.toFixed(2)).toBe('-0.20');
  });

  it('beta: half the market moves gives 0,5; a flat benchmark gives none', () => {
    const b = [0.02, -0.01, 0.03, -0.02].map(D);
    expect(beta(b.map((x) => ({ portfolio: x.div(2), benchmark: x })))!.toFixed(2)).toBe('0.50');
    expect(beta(b.map((x) => ({ portfolio: x, benchmark: D(0) })))).toBeNull();
  });

  it('worst month against the last value of the month before', () => {
    const w = worstMonth([
      { date: '2026-01-10', index: D(1) },
      { date: '2026-01-31', index: D(1.05) },
      { date: '2026-02-15', index: D(0.9) },
      { date: '2026-02-28', index: D(0.98) },
      { date: '2026-03-31', index: D(1.0) },
    ])!;
    expect(w.month).toBe('2026-02');
    expect(w.ret.times(100).toFixed(2)).toBe('-6.67');
  });

  const h = (id: string, value: number, f: Partial<Holding> = {}): Holding => ({
    instrumentId: id,
    ticker: id,
    name: id,
    kind: 'share',
    assetClass: 'stocks',
    currency: 'RUB',
    issuer: null,
    isCash: false,
    value: D(value),
    ...f,
  });
  const holdings = [
    h('OFZ1', 300, { kind: 'bond', assetClass: 'bonds', issuer: 'Минфин' }),
    h('OFZ2', 200, { kind: 'bond', assetClass: 'bonds', issuer: 'Минфин' }),
    h('LKOH', 90),
    h('BTC', 80, { kind: 'crypto', assetClass: 'crypto', currency: 'USD' }),
    h('ETH', 50, { kind: 'crypto', assetClass: 'crypto', currency: 'USD' }),
    h('USD', 30, { kind: 'currency', assetClass: 'cash', currency: 'USD', isCash: true }),
    h('RUB', 250, { kind: 'currency', assetClass: 'cash', isCash: true }),
  ];
  const total = D(1000);

  it('largest positions skip cash', () => {
    const l = largest(holdings, total, 3);
    expect(l.top.map((x) => x.instrumentId)).toEqual(['OFZ1', 'OFZ2', 'LKOH']);
    expect(l.share.toFixed(1)).toBe('59.0');
  });

  it('risk currency: coins by name, the rest by currency', () => {
    expect(riskCurrencies(holdings, total).map((c) => [c.key, c.share.toFixed(1)])).toEqual([
      ['RUB', '84.0'],
      ['BTC', '8.0'],
      ['ETH', '5.0'],
      ['USD', '3.0'],
    ]);
  });

  it('limits: issuers joined by the issuer field, the largest share, crypto as a class', () => {
    const c = limitChecks(holdings, total, { issuerPct: 40, singleStockPct: 8, cryptoPct: 15 });
    expect([c.issuer.name, c.issuer.share.toFixed(1), c.issuer.exceeded]).toEqual(['Минфин', '50.0', true]);
    expect([c.singleStock.name, c.singleStock.share.toFixed(1), c.singleStock.exceeded]).toEqual([
      'LKOH',
      '9.0',
      true,
    ]);
    expect([c.crypto.share.toFixed(1), c.crypto.exceeded]).toEqual(['13.0', false]);
  });
});
