import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import type { LedgerContext, LedgerOperation } from './ledger-types';
import { closeFifo, openLot, reduceLotCost, scaleLots } from './lots';
import { Money } from './money';
import { draftToFields } from './operation-input';
import { buildLedger } from './positions';

const D = (v: string | number) => new Decimal(v);
const at = new Date('2026-01-10T00:00:00Z');

describe('Money arithmetic', () => {
  it('divides, takes ratios, negates and compares', () => {
    const m = Money.of(100, 'RUB');
    expect(m.div(4).amount.toFixed()).toBe('25');
    expect(m.ratio(Money.of(400, 'RUB')).toFixed()).toBe('0.25');
    expect(m.neg().isNegative()).toBe(true);
    expect(m.neg().abs().equals(m)).toBe(true);
    expect(m.sub(Money.of(30, 'RUB')).amount.toFixed()).toBe('70');
    expect(m.compare(Money.of(100, 'RUB'))).toBe(0);
    expect(m.equals(Money.of(100, 'USD'))).toBe(false);
  });
});

describe('lots at the edges', () => {
  const lot = (qty: number, price: number) =>
    openLot({
      operationId: `o${qty}`,
      instrumentId: 'x',
      tagId: null,
      at: new Date('2026-01-01T00:00:00Z'),
      quantity: D(qty),
      price: D(price),
      accruedInterest: D(0),
      fee: D(1),
      deductFees: false,
    });

  it('a zero-quantity lot has zero unit cost', () => {
    expect(lot(0, 100).unitCost.toFixed()).toBe('0');
  });

  it('closing skips empty lots, counts holding days and reports the shortfall', () => {
    const empty = lot(5, 10);
    empty.remaining = D(0);
    const full = lot(3, 20);
    const r = closeFifo([empty, full], { operationId: 's', at, quantity: D(4), proceeds: D(100) });
    expect(r.closures).toHaveLength(1);
    expect(r.closures[0]!.holdingDays).toBe(9);
    expect(r.shortfall.toFixed()).toBe('1');
  });

  it('scaling and cost reduction leave closed lots alone, and nothing to reduce is a no-op', () => {
    const closed = lot(2, 10);
    closed.remaining = D(0);
    const open = lot(2, 10);
    scaleLots([closed, open], D(2));
    expect([closed.quantity.toFixed(), open.quantity.toFixed()]).toEqual(['2', '4']);
    reduceLotCost([closed], D(5));
    expect(closed.unitCost.toFixed()).toBe('10');
    reduceLotCost([open], D(100));
    expect(open.unitCost.toFixed()).toBe('0');
  });
});

describe('ledger at the edges', () => {
  const ctx: LedgerContext = {
    tagRules: new Map(),
    accountDefaultTagId: null,
    cashInstrumentId: (c) => `cash-${c}`,
    deductFees: true,
  };
  const op = (fields: Partial<LedgerOperation> & Pick<LedgerOperation, 'id' | 'type'>): LedgerOperation => ({
    executedAt: at,
    createdAt: at,
    instrumentId: null,
    quantity: D(0),
    price: D(0),
    currency: 'RUB',
    amount: D(0),
    fee: D(0),
    tax: D(0),
    accruedInterest: D(0),
    tagId: null,
    voided: false,
    ...fields,
  });

  it('flags currency deals without a currency, splits without a position and zero-price transfers', () => {
    const l = buildLedger(
      [
        op({ id: 'fx', type: 'fx_sell', amount: D(100) }),
        op({ id: 'sp', type: 'split', instrumentId: 'x', quantity: D(5) }),
        op({ id: 'tr', type: 'transfer_in', instrumentId: 'y', quantity: D(5) }),
        op({ id: 'out', type: 'transfer_out', instrumentId: 'y', quantity: D(9) }),
      ],
      ctx,
    );
    expect(l.issues.map((i) => `${i.operationId}:${i.code}`)).toEqual([
      'fx:MISSING_INSTRUMENT',
      'sp:NO_POSITION',
      'tr:ZERO_PRICE',
      'out:OVERSOLD',
    ]);
  });

  it('selling currency lowers the bought-currency cell, and a currency payout lands on cash', () => {
    const l = buildLedger(
      [
        op({ id: 'b', type: 'fx_buy', instrumentId: 'cash-USD', quantity: D(100), amount: D(-9000) }),
        op({ id: 's', type: 'fx_sell', instrumentId: 'cash-USD', quantity: D(40), amount: D(3600) }),
        op({ id: 'i', type: 'interest', instrumentId: 'cash-RUB', amount: D(50) }),
      ],
      ctx,
    );
    const usd = l.positions.find((p) => p.instrumentId === 'cash-USD')!;
    expect(usd.quantity.toFixed()).toBe('60');
    expect(l.positions.find((p) => p.instrumentId === 'cash-RUB')!.payoutsTotal.toFixed()).toBe('50');
  });
});

describe('draftToFields for charges and cash', () => {
  it('maps tax and deposit drafts', () => {
    const tax = draftToFields({ kind: 'charge', type: 'tax', total: D(13) });
    expect([tax.amount.toFixed(), tax.tax.toFixed(), tax.fee.toFixed()]).toEqual(['-13', '13', '0']);
    expect(draftToFields({ kind: 'cashflow', type: 'deposit', total: D(5) }).amount.toFixed()).toBe('5');
  });
});
