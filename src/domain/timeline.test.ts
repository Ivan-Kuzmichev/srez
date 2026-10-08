import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import type { LedgerContext, LedgerOperation } from './ledger-types';
import { buildLedger } from './positions';
import { dailyQuantities, valueOn } from './timeline';

const D = (v: string | number) => new Decimal(v);
const ctx: LedgerContext = {
  tagRules: new Map(),
  accountDefaultTagId: null,
  cashInstrumentId: (c) => `cash-${c}`,
  deductFees: true,
};
const op = (id: string, day: string, f: Partial<LedgerOperation>): LedgerOperation => ({
  id,
  type: 'buy',
  executedAt: new Date(`${day}T10:00:00Z`),
  createdAt: new Date(`${day}T10:00:00Z`),
  instrumentId: 'sber',
  quantity: D(0),
  price: D(0),
  currency: 'RUB',
  amount: D(0),
  fee: D(0),
  tax: D(0),
  accruedInterest: D(0),
  tagId: null,
  voided: false,
  ...f,
});
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

const ops = [
  op('1', '2026-01-02', { type: 'deposit', instrumentId: null, amount: D(10000) }),
  op('2', '2026-01-03', { quantity: D(10), price: D(100), amount: D(-1000) }),
  op('3', '2026-01-05', { type: 'sell', quantity: D(4), price: D(120), amount: D(480) }),
  op('4', '2026-01-06', { type: 'split', quantity: D(6) }),
  op('5', '2026-01-06', {
    type: 'buy',
    instrumentId: 'btc',
    quantity: D('0.01'),
    price: D(6000000),
    amount: D(-60000),
    voided: true,
  }),
];

describe('dailyQuantities', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'];
  const t = dailyQuantities(ops, ctx, days, dayOf);
  const q = (date: string, id: string) =>
    t
      .get(date)!
      .find((c) => c.instrumentId === id)
      ?.quantity.toFixed() ?? '0';

  it('carries quantities between operation days', () => {
    expect(t.get('2026-01-01')).toEqual([]);
    expect([q('2026-01-02', 'cash-RUB'), q('2026-01-02', 'sber')]).toEqual(['10000', '0']);
    expect([q('2026-01-04', 'cash-RUB'), q('2026-01-04', 'sber')]).toEqual(['9000', '10']);
    expect([q('2026-01-05', 'cash-RUB'), q('2026-01-05', 'sber')]).toEqual(['9480', '6']);
  });

  it('applies splits, keeps the last trade price per unit and skips voided', () => {
    const sber = t.get('2026-01-06')!.find((c) => c.instrumentId === 'sber')!;
    expect(sber.quantity.toFixed()).toBe('12');
    expect(sber.lastTradePrice!.toFixed()).toBe('60');
    expect(q('2026-01-06', 'btc')).toBe('0');
  });

  it('agrees with buildLedger on the final quantities', () => {
    const final = t.get('2026-01-06')!;
    for (const p of buildLedger(ops, ctx).positions.filter((x) => !x.quantity.isZero())) {
      expect(final.find((c) => c.instrumentId === p.instrumentId)!.quantity.toFixed()).toBe(
        p.quantity.toFixed(),
      );
    }
  });
});

describe('valueOn', () => {
  const series = [{ date: '2026-01-02' }, { date: '2026-01-05' }, { date: '2026-01-09' }];
  it('takes the last point on or before the date', () => {
    expect(valueOn(series, '2026-01-01')).toBeNull();
    expect(valueOn(series, '2026-01-05')).toEqual({ date: '2026-01-05' });
    expect(valueOn(series, '2026-01-08')).toEqual({ date: '2026-01-05' });
    expect(valueOn(series, '2027-01-01')).toEqual({ date: '2026-01-09' });
  });
});
