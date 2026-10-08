import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import type { LedgerContext, LedgerOperation, OperationType } from './ledger-types';
import { buildLedger, resolveTag, unrealized } from './positions';

const D = (v: string | number) => new Decimal(v);
const RUB = 'cash-rub';
const ctx = (over: Partial<LedgerContext> = {}): LedgerContext => ({
  tagRules: new Map(),
  accountDefaultTagId: null,
  cashInstrumentId: (c) => `cash-${c.toLowerCase()}`,
  deductFees: true,
  ...over,
});

let seq = 0;
function op(
  type: OperationType,
  fields: Partial<Omit<LedgerOperation, 'quantity' | 'price' | 'amount' | 'fee'>> & {
    qty?: string | number;
    price?: string | number;
    amount?: string | number;
    fee?: string | number;
    day?: number;
  },
): LedgerOperation {
  seq += 1;
  const qty = D(fields.qty ?? 0);
  const price = D(fields.price ?? 0);
  const fee = D(fields.fee ?? 0);
  const defaultAmount =
    type === 'buy' ? qty.times(price).plus(fee).neg() : type === 'sell' ? qty.times(price).minus(fee) : D(0);
  return {
    id: fields.id ?? `op${seq}`,
    type,
    executedAt: new Date(Date.UTC(2026, 0, fields.day ?? seq)),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    instrumentId: fields.instrumentId ?? 'sber',
    quantity: qty,
    price,
    currency: fields.currency ?? 'RUB',
    amount: fields.amount !== undefined ? D(fields.amount) : defaultAmount,
    fee,
    tax: D(0),
    accruedInterest: fields.accruedInterest ?? D(0),
    tagId: fields.tagId ?? null,
    voided: fields.voided ?? false,
  };
}

const position = (l: ReturnType<typeof buildLedger>, instrumentId: string, tagId: string | null = null) =>
  l.positions.find((p) => p.instrumentId === instrumentId && p.tagId === tagId)!;

describe('эталон 1.1: акция', () => {
  const ops = [
    op('buy', { qty: 500, price: '251.00' }),
    op('buy', { qty: 400, price: '271.20' }),
    op('buy', { qty: 200, price: '284.45' }),
    op('buy', { qty: 100, price: '312.10' }),
  ];
  const sber = position(buildLedger(ops, ctx()), 'sber');

  it('quantity, cost basis, average price', () => {
    expect(sber.quantity.toFixed()).toBe('1200');
    expect(sber.costBasis.toFixed()).toBe('322080');
    expect(sber.avgPrice.toFixed(2)).toBe('268.40');
  });

  it('value and unrealized result at 312,50', () => {
    const r = unrealized(sber, D('312.50'));
    expect(r.value.toFixed()).toBe('375000');
    expect(r.unrealized.toFixed()).toBe('52920');
    expect(r.unrealizedPct.toFixed(2)).toBe('16.43');
  });

  it('cash goes down by the purchases', () => {
    expect(position(buildLedger(ops, ctx()), RUB).quantity.toFixed()).toBe('-322080');
  });
});

describe('эталон 1.2: с выплатами', () => {
  it('payouts and the full result', () => {
    const ops = [
      op('buy', { qty: 500, price: '251.00' }),
      op('buy', { qty: 400, price: '271.20' }),
      op('buy', { qty: 200, price: '284.45' }),
      op('buy', { qty: 100, price: '312.10' }),
      op('dividend', { amount: 17000 }),
      op('dividend', { amount: 37400 }),
    ];
    const sber = position(buildLedger(ops, ctx()), 'sber');
    expect(sber.payoutsTotal.toFixed()).toBe('54400');
    const r = unrealized(sber, D('312.50'));
    const full = r.unrealized.plus(sber.payoutsTotal).plus(sber.realizedPnl);
    expect(full.toFixed()).toBe('107320');
    expect(full.div(sber.costBasis).times(100).toFixed(2)).toBe('33.32');
  });
});

describe('эталон 1.3: дробное количество', () => {
  it('keeps every digit', () => {
    const ops = [
      op('buy', { instrumentId: 'btc', qty: '0.0620', price: 5240000 }),
      op('buy', { instrumentId: 'btc', qty: '0.0100', price: 6120000 }),
    ];
    const btc = position(buildLedger(ops, ctx()), 'btc');
    expect(btc.quantity.toFixed()).toBe('0.072');
    expect(btc.avgPrice.toFixed(2)).toBe('5362222.22');
  });
});

describe('эталон 1.4: FIFO', () => {
  it('closes the oldest lot first', () => {
    const ops = [
      op('buy', { qty: 10, price: 100 }),
      op('buy', { qty: 10, price: 120 }),
      op('sell', { qty: 15, price: 130 }),
    ];
    const l = buildLedger(ops, ctx());
    expect(l.closures.map((c) => [c.quantity.toFixed(), c.lot.unitCost.toFixed()])).toEqual([
      ['10', '100'],
      ['5', '120'],
    ]);
    const pnl = l.closures.reduce((s, c) => s.plus(c.pnl), D(0));
    expect(pnl.toFixed()).toBe('350');
    const sber = position(l, 'sber');
    expect(sber.quantity.toFixed()).toBe('5');
    expect(sber.costBasis.toFixed()).toBe('600');
    expect(sber.realizedPnl.toFixed()).toBe('350');
    expect(l.lots.filter((x) => x.remaining.gt(0)).map((x) => x.unitCost.toFixed())).toEqual(['120']);
  });
});

describe('fees, accrued interest and order', () => {
  it('puts the fee into the lot cost and out of proceeds when deductFees is on', () => {
    const ops = [op('buy', { qty: 10, price: 100, fee: 5 }), op('sell', { qty: 10, price: 110, fee: 5 })];
    const l = buildLedger(ops, ctx());
    expect(l.closures[0]!.cost.toFixed()).toBe('1005');
    expect(l.closures[0]!.proceeds.toFixed()).toBe('1095');
    expect(l.closures[0]!.pnl.toFixed()).toBe('90');
    const off = buildLedger(ops, ctx({ deductFees: false }));
    expect(off.closures[0]!.pnl.toFixed()).toBe('100');
  });

  it('adds accrued interest to a bond lot but not to the average price', () => {
    const ops = [
      op('buy', { instrumentId: 'ofz', qty: 10, price: 990, accruedInterest: D(150), amount: -10050 }),
    ];
    const ofz = position(buildLedger(ops, ctx()), 'ofz');
    expect(ofz.costBasis.toFixed()).toBe('10050');
    expect(ofz.avgPrice.toFixed()).toBe('990');
  });

  it('sorts by execution time, then by creation', () => {
    const sell = op('sell', { qty: 5, price: 130, day: 10 });
    const buy = op('buy', { qty: 10, price: 100, day: 1 });
    expect(position(buildLedger([sell, buy], ctx()), 'sber').quantity.toFixed()).toBe('5');
  });

  it('skips voided operations', () => {
    const ops = [op('buy', { qty: 10, price: 100 }), op('buy', { qty: 10, price: 100, voided: true })];
    expect(position(buildLedger(ops, ctx()), 'sber').quantity.toFixed()).toBe('10');
  });

  it('reports overselling instead of going negative', () => {
    const l = buildLedger(
      [op('buy', { qty: 5, price: 100 }), op('sell', { id: 'big', qty: 8, price: 110 })],
      ctx(),
    );
    expect(position(l, 'sber').quantity.toFixed()).toBe('0');
    expect(l.issues).toEqual([{ operationId: 'big', code: 'OVERSOLD' }]);
  });
});

describe('cash', () => {
  it('is a position per currency moved by every amount', () => {
    const ops = [
      op('deposit', { instrumentId: null, amount: 100000 }),
      op('buy', { qty: 10, price: 100, fee: 1 }),
      op('fee', { instrumentId: null, amount: -50 }),
      op('deposit', { instrumentId: null, amount: 500, currency: 'USD' }),
    ];
    const l = buildLedger(ops, ctx());
    expect(position(l, RUB).quantity.toFixed()).toBe('98949');
    expect(position(l, RUB).isCash).toBe(true);
    expect(position(l, 'cash-usd').quantity.toFixed()).toBe('500');
  });

  it('buying currency moves both cash cells', () => {
    const l = buildLedger(
      [op('fx_buy', { instrumentId: 'cash-usd', qty: 100, price: 92, amount: -9200 })],
      ctx(),
    );
    expect(position(l, 'cash-usd').quantity.toFixed()).toBe('100');
    expect(position(l, RUB).quantity.toFixed()).toBe('-9200');
  });
});

describe('tags', () => {
  it('resolve explicit, then rule, then account default, then none', () => {
    const c = ctx({ tagRules: new Map([['sber', 'pension']]), accountDefaultTagId: 'kids' });
    expect(resolveTag('sber', 'explicit', c)).toBe('explicit');
    expect(resolveTag('sber', null, c)).toBe('pension');
    expect(resolveTag('lkoh', null, c)).toBe('kids');
    expect(resolveTag('lkoh', null, ctx())).toBeNull();
  });

  it('split one instrument into cells by tag; money stays in the cash cell of the default tag', () => {
    const ops = [
      op('buy', { qty: 10, price: 100, tagId: 'a' }),
      op('buy', { qty: 5, price: 100, tagId: 'b' }),
    ];
    const l = buildLedger(ops, ctx({ accountDefaultTagId: 'main' }));
    expect(position(l, 'sber', 'a').quantity.toFixed()).toBe('10');
    expect(position(l, 'sber', 'b').quantity.toFixed()).toBe('5');
    expect(position(l, RUB, 'main').quantity.toFixed()).toBe('-1500');
    expect(l.positions.filter((p) => p.isCash)).toHaveLength(1);
  });
});

describe('currencies of cost', () => {
  it('keep the currency of the trades and flag a mix', () => {
    const l = buildLedger(
      [
        op('buy', { instrumentId: 'btc', qty: '0.01', price: 6000000 }),
        op('buy', {
          id: 'usd-buy',
          instrumentId: 'btc',
          qty: '0.01',
          price: 80000,
          currency: 'USD',
          amount: -800,
        }),
      ],
      ctx(),
    );
    expect(position(l, 'btc').costCurrency).toBe('RUB');
    expect(l.issues).toEqual([{ operationId: 'usd-buy', code: 'MIXED_CURRENCY' }]);
  });
});

describe('corporate actions', () => {
  it('a split scales open lots and keeps the cost', () => {
    const ops = [op('buy', { qty: 10, price: 100 }), op('split', { qty: 90 })];
    const sber = position(buildLedger(ops, ctx()), 'sber');
    expect(sber.quantity.toFixed()).toBe('100');
    expect(sber.costBasis.toFixed()).toBe('1000');
    expect(sber.avgPrice.toFixed()).toBe('10');
  });

  it('amortization returns principal: cash in, cost down, quantity kept, not a payout', () => {
    const ops = [
      op('buy', { instrumentId: 'ofz', qty: 10, price: 1000 }),
      op('amortization', { instrumentId: 'ofz', amount: 2000 }),
    ];
    const l = buildLedger(ops, ctx());
    const ofz = position(l, 'ofz');
    expect(ofz.quantity.toFixed()).toBe('10');
    expect(ofz.costBasis.toFixed()).toBe('8000');
    expect(ofz.payoutsTotal.toFixed()).toBe('0');
    expect(position(l, RUB).quantity.toFixed()).toBe('-8000');
  });

  it('redemption closes the lots like a sale at nominal', () => {
    const ops = [
      op('buy', { instrumentId: 'ofz', qty: 10, price: 980 }),
      op('redemption', { instrumentId: 'ofz', qty: 10, price: 1000, amount: 10000 }),
    ];
    const l = buildLedger(ops, ctx());
    expect(position(l, 'ofz').quantity.toFixed()).toBe('0');
    expect(position(l, 'ofz').realizedPnl.toFixed()).toBe('200');
  });

  it('transfers move units without realizing a result', () => {
    const ops = [op('transfer_in', { qty: 10, price: 100 }), op('transfer_out', { qty: 4 })];
    const l = buildLedger(ops, ctx());
    expect(position(l, 'sber').quantity.toFixed()).toBe('6');
    expect(position(l, 'sber').realizedPnl.toFixed()).toBe('0');
    expect(l.closures).toHaveLength(0);
  });
});
