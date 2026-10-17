import { describe, expect, it } from 'vitest';
import type { AssetClass } from './allocation';
import { Decimal } from './decimal';
import {
  lotsFor,
  ordersFor,
  rebalance,
  roundToStep,
  sectorOrders,
  sectorRebalance,
  ordersWithSectors,
} from './rebalance';

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

describe('эталон 8.3: ребаланс по отраслям', () => {
  const D = (v: string | number) => new Decimal(v);
  const values = new Map([
    ['it', D(618)],
    ['financial', D(172)],
    ['energy', D(94)],
    ['materials', D(61)],
    ['consumer', D(55)],
  ]);
  const targets = new Map([
    ['it', D(40)],
    ['financial', D(25)],
    ['energy', D(15)],
    ['materials', D(10)],
    ['consumer', D(10)],
  ]);
  const trades = (p: ReturnType<typeof sectorRebalance>) =>
    Object.fromEntries(p.map((x) => [x.sector, x.trade.toFixed()]));

  it('buying only 200: the sectors below target by their gap, IT gets nothing', () => {
    const p = sectorRebalance({ values, targets, trade: D(200), mode: 'buy-only', step: D(1) });
    expect(trades(p)).toEqual({ financial: '76', energy: '51', consumer: '38', materials: '35', it: '0' });
  });

  it('buying and selling: every sector to its target, the trades add up to nothing', () => {
    const p = sectorRebalance({ values, targets, trade: D(0), mode: 'buy-sell', step: D(1) });
    expect(trades(p)).toEqual({ financial: '78', energy: '56', consumer: '45', materials: '39', it: '-218' });
    expect(p.every((x) => x.deviation!.abs().lt(0.2))).toBe(true);
  });

  it('a sector without a target takes what the targets leave; one with nothing held becomes a gap', () => {
    const p = sectorRebalance({
      values: new Map([
        ['it', D(500)],
        ['telecom', D(500)],
      ]),
      targets: new Map([
        ['it', D(40)],
        ['energy', D(20)],
      ]),
      trade: D(500),
      mode: 'buy-only',
      step: D(1),
    });
    // After 1 500: energy needs 300 and IT 100 (40 % of 1 500 is 600); the 100 left go to telecom.
    expect(trades(p)).toEqual({ energy: '300', it: '100', telecom: '100' });
    const cand = (ticker: string, price: number) => ({
      instrumentId: ticker,
      ticker,
      name: ticker,
      kind: 'share',
      price: D(price),
      lot: D(1),
      quantity: D(10),
      assetClass: 'stocks' as const,
    });
    const { orders, gaps } = sectorOrders(
      p,
      new Map([
        ['it', cand('YDEX', 50)],
        ['telecom', cand('MTSS', 25)],
      ]),
    );
    expect(orders.map((o) => [o.ticker, o.side, o.quantity.toFixed()])).toEqual([
      ['YDEX', 'buy', '2'],
      ['MTSS', 'buy', '4'],
    ]);
    expect(gaps).toEqual([{ sector: 'energy', amount: D(300) }]);
  });
});

describe('ребаланс по отраслям: края', () => {
  const D = (v: string | number) => new Decimal(v);
  const cand = (ticker: string, price: number, assetClass: 'stocks' | 'funds' | 'bonds' = 'stocks') => ({
    instrumentId: ticker,
    ticker,
    name: ticker,
    kind: 'share',
    price: D(price),
    lot: D(1),
    quantity: D(10),
    assetClass,
  });

  it('without free sectors the rest goes to the targeted ones by target; a sale stays within the holding', () => {
    const p = sectorRebalance({
      values: new Map([
        ['it', D(800)],
        ['energy', D(200)],
      ]),
      targets: new Map([
        ['it', D(50)],
        ['energy', D(50)],
      ]),
      trade: D(0),
      mode: 'buy-sell',
      step: D(1),
    });
    expect(Object.fromEntries(p.map((x) => [x.sector, x.trade.toFixed()]))).toEqual({
      energy: '300',
      it: '-300',
    });
    const { orders } = sectorOrders(
      p,
      new Map([
        ['it', cand('YDEX', 10)],
        ['energy', cand('LKOH', 100)],
      ]),
    );
    // 30 YDEX to sell, but only 10 are held.
    expect(orders.map((o) => [o.ticker, o.side, o.quantity.toFixed()])).toEqual([
      ['LKOH', 'buy', '3'],
      ['YDEX', 'sell', '10'],
    ]);
    const leftOver = sectorRebalance({
      values: new Map([['it', D(500)]]),
      targets: new Map([
        ['it', D(30)],
        ['energy', D(70)],
      ]),
      trade: D(1000),
      mode: 'buy-only',
      step: D(1),
    });
    // Energy's gap is 1 050, more than the 1 000: it takes all; IT is above its 450.
    expect(Object.fromEntries(leftOver.map((x) => [x.sector, x.trade.toFixed()]))).toEqual({
      energy: '1000',
      it: '0',
    });
  });

  it('orders with sectors replace the equity orders; without sector targets the class orders stay', () => {
    const plan = rebalance({
      values: new Map([
        ['stocks', D(1000)],
        ['bonds', D(1000)],
      ]),
      targets: new Map([
        ['stocks', D(50)],
        ['bonds', D(50)],
      ]),
      contribution: D(400),
      mode: 'buy-only',
      useExcessCash: false,
      step: D(1),
    });
    const classCandidates = new Map([
      ['stocks', cand('SBER', 100)],
      ['bonds', cand('OFZ', 100, 'bonds')],
    ]) as Parameters<typeof ordersWithSectors>[1];
    const plain = ordersWithSectors(plan, classCandidates, null);
    expect(plain.orders.map((o) => o.ticker).sort()).toEqual(['OFZ', 'SBER']);
    expect(plain.sectors).toEqual([]);
    const split = ordersWithSectors(plan, classCandidates, {
      values: new Map([['financial', D(1000)]]),
      targets: new Map([['energy', D(50)]]),
      candidates: new Map([['financial', cand('SBER', 100)]]),
      mode: 'buy-only',
      step: D(1),
    });
    // 200 on shares: all to energy (nothing held there), so no SBER order, a gap instead.
    expect(split.orders.map((o) => o.ticker)).toEqual(['OFZ']);
    expect(split.gaps).toEqual([{ sector: 'energy', amount: D(200) }]);
    expect(
      ordersWithSectors(plan, classCandidates, {
        ...split,
        values: new Map(),
        targets: new Map(),
        candidates: new Map(),
        mode: 'buy-only',
      }).sectors,
    ).toEqual([]);
  });
});
