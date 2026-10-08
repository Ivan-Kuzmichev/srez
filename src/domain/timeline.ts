import { Decimal } from './decimal';
import type { LedgerContext, LedgerOperation } from './ledger-types';
import { resolveTag } from './positions';

const ZERO = new Decimal(0);

export interface CellDay {
  instrumentId: string;
  tagId: string | null;
  isCash: boolean;
  quantity: Decimal;
  /** Price of the latest trade in this cell, for valuing it when no market price is known. */
  lastTradePrice: Decimal | null;
  lastTradeCurrency: string | null;
}

/**
 * End-of-day quantities per cell (instrument, tag) for each requested date, in one pass over the
 * journal. Follows the same quantity rules as buildLedger (docs/04-calculations.md, section 1)
 * without the lot bookkeeping, so years of history stay cheap. `dayOf` maps an operation to its
 * local calendar date.
 */
export function dailyQuantities(
  operations: readonly LedgerOperation[],
  ctx: LedgerContext,
  dates: readonly string[],
  dayOf: (at: Date) => string,
): Map<string, CellDay[]> {
  const ordered = [...operations]
    .filter((o) => !o.voided)
    .sort(
      (a, b) =>
        a.executedAt.getTime() - b.executedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
    );
  const cells = new Map<string, CellDay>();
  const cell = (instrumentId: string, tagId: string | null, isCash: boolean) => {
    const key = `${instrumentId}|${tagId ?? ''}`;
    let c = cells.get(key);
    if (!c) {
      c = { instrumentId, tagId, isCash, quantity: ZERO, lastTradePrice: null, lastTradeCurrency: null };
      cells.set(key, c);
    }
    return c;
  };

  const result = new Map<string, CellDay[]>();
  let i = 0;
  for (const date of dates) {
    for (; i < ordered.length && dayOf(ordered[i]!.executedAt) <= date; i++) {
      const op = ordered[i]!;
      const cashId = ctx.cashInstrumentId(op.currency);
      const tagId = resolveTag(op.instrumentId ?? cashId, op.tagId, ctx);
      if (!op.amount.isZero()) {
        const cash = cell(cashId, tagId, true);
        cash.quantity = cash.quantity.plus(op.amount);
      }
      if (!op.instrumentId) continue;
      if (op.type === 'fx_buy' || op.type === 'fx_sell') {
        const target = cell(op.instrumentId, tagId, true);
        target.quantity =
          op.type === 'fx_buy' ? target.quantity.plus(op.quantity) : target.quantity.minus(op.quantity);
        continue;
      }
      if (op.instrumentId === cashId) continue;
      const c = cell(op.instrumentId, tagId, false);
      switch (op.type) {
        case 'buy':
        case 'transfer_in':
        case 'accrual':
          c.quantity = c.quantity.plus(op.quantity);
          break;
        case 'sell':
        case 'redemption':
        case 'transfer_out':
          // Overselling never goes below zero, as in buildLedger.
          c.quantity = Decimal.max(ZERO, c.quantity.minus(op.quantity));
          break;
        case 'split':
          if (c.quantity.gt(0)) {
            const ratio = c.quantity.plus(op.quantity).div(c.quantity);
            c.quantity = c.quantity.plus(op.quantity);
            if (c.lastTradePrice) c.lastTradePrice = c.lastTradePrice.div(ratio);
          }
          break;
      }
      if (op.price.gt(0) && ['buy', 'sell', 'transfer_in', 'redemption'].includes(op.type)) {
        c.lastTradePrice = op.price;
        c.lastTradeCurrency = op.currency;
      }
    }
    result.set(
      date,
      [...cells.values()].filter((c) => !c.quantity.isZero()).map((c) => ({ ...c })),
    );
  }
  return result;
}

/** Last value on or before `date` from a series sorted by date ascending. */
export function valueOn<T extends { date: string }>(series: readonly T[], date: string): T | null {
  let lo = 0;
  let hi = series.length - 1;
  let found: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]!.date <= date) {
      found = series[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
