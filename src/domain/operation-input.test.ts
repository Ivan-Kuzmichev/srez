import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import type { LedgerContext, LedgerOperation } from './ledger-types';
import { draftToFields, draftTotal, previewChange } from './operation-input';

const D = (v: string | number) => new Decimal(v);
const ctx: LedgerContext = {
  tagRules: new Map(),
  accountDefaultTagId: null,
  cashInstrumentId: (c) => `cash-${c}`,
  deductFees: true,
};

describe('draftToFields', () => {
  it('buys spend price, quantity and fee; sells bring them in minus the fee', () => {
    const buy = draftToFields({
      kind: 'trade',
      side: 'buy',
      quantity: D('0.01'),
      price: D(6120000),
      fee: D(0),
    });
    expect(buy.amount.toFixed()).toBe('-61200');
    const sell = draftToFields({ kind: 'trade', side: 'sell', quantity: D(10), price: D(4190), fee: D(10) });
    expect(sell.amount.toFixed()).toBe('41890');
    expect(
      draftTotal({ kind: 'trade', side: 'buy', quantity: D(5), price: D(7080), fee: D(94) }).toFixed(),
    ).toBe('35494');
  });

  it('payouts arrive net of tax and keep the tax', () => {
    const f = draftToFields({ kind: 'payout', type: 'dividend', gross: D(1000), tax: D(130) });
    expect([f.type, f.amount.toFixed(), f.tax.toFixed()]).toEqual(['dividend', '870', '130']);
  });

  it('cash flows and charges get their sign from the type', () => {
    expect(draftToFields({ kind: 'cashflow', type: 'withdrawal', total: D(500) }).amount.toFixed()).toBe(
      '-500',
    );
    const fee = draftToFields({ kind: 'charge', type: 'fee', total: D(94) });
    expect([fee.amount.toFixed(), fee.fee.toFixed()]).toEqual(['-94', '94']);
  });
});

describe('previewChange', () => {
  const op = (id: string, qty: string, price: number): LedgerOperation => ({
    id,
    type: 'buy',
    executedAt: new Date(Date.UTC(2026, 0, Number(id.slice(1)))),
    createdAt: new Date(0),
    instrumentId: 'btc',
    quantity: D(qty),
    price: D(price),
    currency: 'RUB',
    amount: D(qty).times(price).neg(),
    fee: D(0),
    tax: D(0),
    accruedInterest: D(0),
    tagId: null,
    voided: false,
  });

  it('shows the reference 1.3 change: 0,0620 → 0,0720 and 5 240 000 → 5 362 222,22', () => {
    const p = previewChange([op('o1', '0.062', 5240000)], op('o2', '0.01', 6120000), ctx)!;
    expect(p.quantityBefore.toFixed()).toBe('0.062');
    expect(p.quantityAfter.toFixed()).toBe('0.072');
    expect(p.avgPriceBefore!.toFixed()).toBe('5240000');
    expect(p.avgPriceAfter!.toFixed(2)).toBe('5362222.22');
  });

  it('starts from nothing for a new position', () => {
    const p = previewChange([], op('o1', '2', 100), ctx)!;
    expect([p.quantityBefore.toFixed(), p.quantityAfter.toFixed(), p.avgPriceBefore]).toEqual([
      '0',
      '2',
      null,
    ]);
  });
});
