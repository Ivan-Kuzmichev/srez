import { Decimal } from './decimal';
import type { OperationType } from './ledger-types';

/** docs/04-calculations.md, section 2: what changes the quantity of a security in an account. */
const INCREASE = new Set<OperationType>(['buy', 'transfer_in', 'fx_buy', 'accrual', 'split']);
const DECREASE = new Set<OperationType>(['sell', 'transfer_out', 'fx_sell', 'redemption']);

/**
 * Quantity held after the given operations of one security in one account, in the order given.
 * Like the lot ledger, a sale beyond the holding stops at zero.
 */
export function heldQuantity(ops: readonly { type: OperationType; quantity: Decimal }[]): Decimal {
  let held = new Decimal(0);
  for (const op of ops) {
    if (INCREASE.has(op.type)) held = held.plus(op.quantity);
    else if (DECREASE.has(op.type)) held = Decimal.max(0, held.minus(op.quantity));
  }
  return held;
}
