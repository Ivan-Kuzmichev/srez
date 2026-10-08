import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { heldQuantity } from './holdings';
import type { OperationType } from './ledger-types';

const op = (type: OperationType, quantity: number | string) => ({ type, quantity: new Decimal(quantity) });

describe('heldQuantity', () => {
  it('adds purchases, transfers in and splits, subtracts sales, transfers out and redemptions', () => {
    expect(heldQuantity([op('buy', 10), op('transfer_in', 5), op('sell', 3)]).toString()).toBe('12');
    expect(heldQuantity([op('buy', 10), op('split', 90)]).toString()).toBe('100');
    expect(heldQuantity([op('buy', 20), op('redemption', 20)]).toString()).toBe('0');
    expect(heldQuantity([op('fx_buy', '100.5'), op('fx_sell', '0.5')]).toString()).toBe('100');
  });

  it('ignores payouts and cash, and never goes below zero', () => {
    expect(heldQuantity([op('buy', 2), op('coupon', 0), op('dividend', 0), op('fee', 0)]).toString()).toBe(
      '2',
    );
    expect(heldQuantity([op('buy', 2), op('sell', 5), op('buy', 1)]).toString()).toBe('1');
    expect(heldQuantity([]).toString()).toBe('0');
  });
});
