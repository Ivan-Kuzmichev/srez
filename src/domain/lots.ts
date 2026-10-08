import { Decimal } from './decimal';
import type { Lot, LotClosure } from './ledger-types';

const DAY_MS = 86_400_000;
const ZERO = new Decimal(0);

/** Opens a lot; unit cost includes accrued interest and, if asked, the fee (docs/04-calculations.md, section 1). */
export function openLot(args: {
  operationId: string;
  instrumentId: string;
  tagId: string | null;
  at: Date;
  quantity: Decimal;
  price: Decimal;
  accruedInterest: Decimal;
  fee: Decimal;
  deductFees: boolean;
}): Lot {
  const total = args.quantity
    .times(args.price)
    .plus(args.accruedInterest)
    .plus(args.deductFees ? args.fee : ZERO);
  return {
    openOperationId: args.operationId,
    instrumentId: args.instrumentId,
    tagId: args.tagId,
    openedAt: args.at,
    quantity: args.quantity,
    remaining: args.quantity,
    unitCost: args.quantity.isZero() ? ZERO : total.div(args.quantity),
    unitPrice: args.price,
  };
}

/**
 * Takes `quantity` out of the open lots, oldest first. With `proceeds` the result is realized and
 * closures are returned; without (a transfer out) units just leave. Returns what could not be covered.
 */
export function closeFifo(
  lots: Lot[],
  args: { operationId: string; at: Date; quantity: Decimal; proceeds: Decimal | null },
): { closures: LotClosure[]; shortfall: Decimal } {
  const closures: LotClosure[] = [];
  let left = args.quantity;
  for (const lot of lots) {
    if (left.lte(0)) break;
    if (lot.remaining.lte(0)) continue;
    const take = Decimal.min(lot.remaining, left);
    lot.remaining = lot.remaining.minus(take);
    left = left.minus(take);
    if (args.proceeds) {
      const cost = take.times(lot.unitCost);
      const proceeds = args.proceeds.times(take).div(args.quantity);
      closures.push({
        lot,
        closeOperationId: args.operationId,
        closedAt: args.at,
        quantity: take,
        cost,
        proceeds,
        pnl: proceeds.minus(cost),
        holdingDays: Math.floor((args.at.getTime() - lot.openedAt.getTime()) / DAY_MS),
      });
    }
  }
  return { closures, shortfall: left };
}

/** A split: every open lot grows by the same ratio, total cost unchanged. */
export function scaleLots(lots: Lot[], ratio: Decimal): void {
  for (const lot of lots) {
    if (lot.remaining.lte(0)) continue;
    lot.quantity = lot.quantity.times(ratio);
    lot.remaining = lot.remaining.times(ratio);
    lot.unitCost = lot.unitCost.div(ratio);
    lot.unitPrice = lot.unitPrice.div(ratio);
  }
}

/** Return of principal (bond amortization): open lots lose cost in proportion, units stay. */
export function reduceLotCost(lots: Lot[], amount: Decimal): void {
  const total = lots.reduce((s, l) => s.plus(l.remaining.times(l.unitCost)), ZERO);
  if (total.lte(0)) return;
  const factor = Decimal.max(ZERO, total.minus(amount)).div(total);
  for (const lot of lots) if (lot.remaining.gt(0)) lot.unitCost = lot.unitCost.times(factor);
}
