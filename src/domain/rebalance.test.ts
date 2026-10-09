import { describe, expect, it } from 'vitest';
import type { AssetClass } from './allocation';
import { Decimal } from './decimal';
import { lotsFor, ordersFor, rebalance, roundToStep } from './rebalance';

const D = (v: number | string) => new Decimal(v);
// Reference 7.1.
const values = new Map<AssetClass, Decimal>([
  ['stocks', D(1130600)],
  ['bonds', D(570600)],
  ['funds', D(387400)],
  ['crypto', D(613100)],
  ['cash', D(244500)],
]);
const targets = new Map<AssetClass, Decimal>([
  ['stocks', D(40)],
  ['bonds', D(25)],
  ['funds', D(15)],
  ['crypto', D(15)],
  ['cash', D(5)],
]);
const by = (plan: ReturnType<typeof rebalance>, c: AssetClass) =>
  plan.classes.find((x) => x.assetClass === c)!;

describe('rebalance (04, section 8)', () => {
  it('reference 8.1: 150 000, buy only, without excess cash', () => {
    const plan = rebalance({
      values,
      targets,
      contribution: D(150000),
      mode: 'buy-only',
      useExcessCash: false,
    });
    expect(plan.excessCash.toString()).toBe('89690');
    expect(
      [
        by(plan, 'bonds').trade,
        by(plan, 'stocks').trade,
        by(plan, 'funds').trade,
        by(plan, 'crypto').trade,
      ].map(String),
    ).toEqual(['78600', '41700', '29700', '0']);
    expect(plan.classes.map((c) => c.afterShare.toFixed(1))).toEqual(['37.9', '21.0', '13.5', '19.8', '7.9']);
    expect(plan.maxDeviationBefore.toFixed(1)).toBe('5.8');
    expect(plan.maxDeviationAfter.toFixed(1)).toBe('4.8');
    expect(plan.leftover.toString()).toBe('0');
    expect(by(plan, 'cash').after.toString()).toBe('244500');
  });

  it('reference 8.2: lots at 634,00, 312,50 and 7,45', () => {
    expect(lotsFor(D(78600), D('634.00'), D(1)).toString()).toBe('124');
    expect(lotsFor(D(41700), D('312.50'), D(1)).toString()).toBe('133');
    expect(lotsFor(D(29700), D('7.45'), D(1)).toString()).toBe('3987');
    expect(lotsFor(D(5000), D(300), D(10)).toString()).toBe('20');
    expect(lotsFor(D(1), D(0), D(1)).toString()).toBe('0');
  });

  it('lets excess cash in, and keeps what the deficits do not take as cash', () => {
    const plan = rebalance({
      values,
      targets,
      contribution: D(150000),
      mode: 'buy-only',
      useExcessCash: true,
    });
    const bought = ['stocks', 'bonds', 'funds'].reduce(
      (s, c) => s.plus(by(plan, c as AssetClass).trade),
      D(0),
    );
    expect(plan.budget.toString()).toBe('239690');
    expect(bought.toString()).toBe('239600');
    expect(plan.leftover.toString()).toBe('90');
    const tiny = rebalance({
      values: new Map([
        ['stocks', D(990)],
        ['cash', D(10)],
      ]),
      targets: new Map([['stocks', D(100)]]),
      contribution: D(500),
      mode: 'buy-only',
      useExcessCash: false,
    });
    expect(by(tiny, 'stocks').trade.toString()).toBe('500');
    expect(tiny.leftover.toString()).toBe('0');
  });

  it('may sell: every class to target, the trades sum to the contribution', () => {
    const plan = rebalance({
      values,
      targets,
      contribution: D(150000),
      mode: 'buy-sell',
      useExcessCash: false,
    });
    expect(by(plan, 'crypto').trade.lt(0)).toBe(true);
    expect(plan.classes.reduce((s, c) => s.plus(c.trade), D(0)).toString()).toBe('150000');
    expect(plan.maxDeviationAfter.lt(0.1)).toBe(true);
  });

  it('rounds to the step and keeps the total', () => {
    expect(roundToStep([D('78580.6'), D('41668.0'), D('29751.4')], D(150000), D(100)).map(String)).toEqual([
      '78600',
      '41700',
      '29700',
    ]);
    expect(roundToStep([D(-149.5), D(249.5)], D(100), D(100)).map(String)).toEqual(['-100', '200']);
  });
});

describe('orders (reference 8.2)', () => {
  const cand = (id: string, price: string, quantity = 1000) => ({
    instrumentId: id,
    ticker: id,
    name: id,
    kind: 'share',
    price: D(price),
    lot: D(1),
    quantity: D(quantity),
  });
  it('turns class amounts into whole lots of the largest position, biggest first', () => {
    const plan = rebalance({
      values,
      targets,
      contribution: D(150000),
      mode: 'buy-only',
      useExcessCash: false,
    });
    const orders = ordersFor(
      plan,
      new Map([
        ['bonds', cand('OFZ', '634.00')],
        ['stocks', cand('SBER', '312.50')],
        ['funds', cand('TMOS', '7.45')],
        ['crypto', cand('BTC', '7000000')],
      ]),
    );
    expect(orders.map((o) => [o.instrumentId, o.side, o.quantity.toString(), o.amount.toString()])).toEqual([
      ['OFZ', 'buy', '124', '78616'],
      ['SBER', 'buy', '133', '41562.5'],
      ['TMOS', 'buy', '3987', '29703.15'],
    ]);
  });

  it('sells no more than is held', () => {
    const plan = rebalance({ values, targets, contribution: D(0), mode: 'buy-sell', useExcessCash: false });
    const orders = ordersFor(plan, new Map([['crypto', cand('BTC', '7000000', 0.01)]]));
    expect(orders).toEqual([]);
    const some = ordersFor(plan, new Map([['crypto', { ...cand('ETH', '200000', 1), lot: D('0.01') }]]));
    expect(some[0]).toMatchObject({ side: 'sell' });
    expect(some[0]!.quantity.lte(1)).toBe(true);
  });
});
