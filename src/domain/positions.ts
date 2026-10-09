import { Decimal } from './decimal';
import type {
  Ledger,
  LedgerContext,
  LedgerIssue,
  LedgerOperation,
  Lot,
  LotClosure,
  Position,
  Sale,
} from './ledger-types';
import { closeFifo, openLot, reduceLotCost, scaleLots } from './lots';

export type * from './ledger-types';

const ZERO = new Decimal(0);

/** Tag order (docs/03-data-model.md): explicit → rule for (account, instrument) → account default → none. */
export function resolveTag(
  instrumentId: string | null,
  explicit: string | null,
  ctx: LedgerContext,
): string | null {
  if (explicit) return explicit;
  if (instrumentId) {
    const rule = ctx.tagRules.get(instrumentId);
    if (rule) return rule;
  }
  return ctx.accountDefaultTagId;
}

const INCREASE = new Set(['buy', 'transfer_in', 'accrual']);
const SELL = new Set(['sell', 'redemption']);
const PAYOUT = new Set(['dividend', 'coupon', 'interest']);

interface Cell {
  instrumentId: string;
  tagId: string | null;
  isCash: boolean;
  lots: Lot[];
  /** Cash only: running balance. */
  balance: Decimal;
  realizedPnl: Decimal;
  payoutsTotal: Decimal;
  firstBuyAt: Date | null;
  /** The average method's running quantity and cost. */
  avgQuantity: Decimal;
  avgCost: Decimal;
}

function byTime(a: LedgerOperation, b: LedgerOperation): number {
  return a.executedAt.getTime() - b.executedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Replays one account's journal into positions, FIFO lots and closures (docs/04-calculations.md, section 1).
 * Pure: the same operations always give the same result, so positions can be rebuilt at any time.
 */
export function buildLedger(operations: readonly LedgerOperation[], ctx: LedgerContext): Ledger {
  const cells = new Map<string, Cell>();
  const closures: LotClosure[] = [];
  const sales: Sale[] = [];
  const issues: LedgerIssue[] = [];

  const cell = (instrumentId: string, tagId: string | null, isCash: boolean): Cell => {
    const key = `${instrumentId}|${tagId ?? ''}`;
    let c = cells.get(key);
    if (!c) {
      c = {
        instrumentId,
        tagId,
        isCash,
        lots: [],
        balance: ZERO,
        realizedPnl: ZERO,
        payoutsTotal: ZERO,
        firstBuyAt: null,
        avgQuantity: ZERO,
        avgCost: ZERO,
      };
      cells.set(key, c);
    }
    return c;
  };
  const isCashInstrument = (id: string, currency: string) => ctx.cashInstrumentId(currency) === id;

  for (const op of [...operations].filter((o) => !o.voided).sort(byTime)) {
    // Securities follow the tag rules; money always sits in the account's cash cell, which belongs to the
    // account's default tag (docs/04-calculations.md, section 3). Currencies bought are money too.
    const tagId = resolveTag(op.instrumentId ?? ctx.cashInstrumentId(op.currency), op.tagId, ctx);
    const cashTagId = ctx.accountDefaultTagId;

    if (!op.amount.isZero()) {
      const cash = cell(ctx.cashInstrumentId(op.currency), cashTagId, true);
      cash.balance = cash.balance.plus(op.amount);
    }

    // Buying or selling currency: the bought currency is a cash cell too.
    if (op.type === 'fx_buy' || op.type === 'fx_sell') {
      if (!op.instrumentId) {
        issues.push({ operationId: op.id, code: 'MISSING_INSTRUMENT' });
        continue;
      }
      const target = cell(op.instrumentId, cashTagId, true);
      target.balance =
        op.type === 'fx_buy' ? target.balance.plus(op.quantity) : target.balance.minus(op.quantity);
      continue;
    }

    if (!op.instrumentId) continue; // deposit, withdrawal, fee, tax without a security: cash only
    if (isCashInstrument(op.instrumentId, op.currency) && !PAYOUT.has(op.type)) continue;

    const c = cell(op.instrumentId, tagId, false);

    if (INCREASE.has(op.type)) {
      if (op.price.isZero() && op.type !== 'accrual') issues.push({ operationId: op.id, code: 'ZERO_PRICE' });
      c.lots.push(
        openLot({
          operationId: op.id,
          instrumentId: op.instrumentId,
          tagId,
          at: op.executedAt,
          quantity: op.quantity,
          price: op.price,
          accruedInterest: op.accruedInterest,
          fee: op.fee,
          deductFees: ctx.deductFees,
          currency: op.currency,
        }),
      );
      const opened = c.lots.at(-1)!;
      c.avgQuantity = c.avgQuantity.plus(opened.quantity);
      c.avgCost = c.avgCost.plus(opened.quantity.times(opened.unitCost));
      if (c.lots.some((l) => l.currency !== op.currency))
        issues.push({ operationId: op.id, code: 'MIXED_CURRENCY' });
      if (op.type === 'buy' && !c.firstBuyAt) c.firstBuyAt = op.executedAt;
    } else if (SELL.has(op.type)) {
      // The accrued interest received with a bond sale is part of the proceeds (section 1).
      const proceeds = op.quantity
        .times(op.price)
        .plus(op.accruedInterest)
        .minus(ctx.deductFees ? op.fee : ZERO);
      const result = closeFifo(c.lots, {
        operationId: op.id,
        at: op.executedAt,
        quantity: op.quantity,
        proceeds,
      });
      closures.push(...result.closures);
      const taken = Decimal.min(op.quantity, c.avgQuantity);
      const averageCost = c.avgQuantity.isZero() ? ZERO : c.avgCost.times(taken).div(c.avgQuantity);
      sales.push({
        operationId: op.id,
        instrumentId: op.instrumentId,
        tagId,
        at: op.executedAt,
        quantity: op.quantity,
        proceeds,
        averageCost,
        currency: op.currency,
      });
      c.avgCost = c.avgCost.minus(averageCost);
      c.avgQuantity = c.avgQuantity.minus(taken);
      c.realizedPnl = result.closures.reduce((s, x) => s.plus(x.pnl), c.realizedPnl);
      if (result.shortfall.gt(0)) issues.push({ operationId: op.id, code: 'OVERSOLD' });
    } else if (op.type === 'transfer_out') {
      const result = closeFifo(c.lots, {
        operationId: op.id,
        at: op.executedAt,
        quantity: op.quantity,
        proceeds: null,
      });
      const taken = Decimal.min(op.quantity, c.avgQuantity);
      if (c.avgQuantity.gt(0)) c.avgCost = c.avgCost.minus(c.avgCost.times(taken).div(c.avgQuantity));
      c.avgQuantity = c.avgQuantity.minus(taken);
      if (result.shortfall.gt(0)) issues.push({ operationId: op.id, code: 'OVERSOLD' });
    } else if (op.type === 'split') {
      const held = c.lots.reduce((s, l) => s.plus(l.remaining), ZERO);
      if (held.isZero()) issues.push({ operationId: op.id, code: 'NO_POSITION' });
      else {
        const ratio = held.plus(op.quantity).div(held);
        scaleLots(c.lots, ratio);
        c.avgQuantity = c.avgQuantity.times(ratio);
      }
    } else if (op.type === 'amortization') {
      reduceLotCost(c.lots, op.amount.abs());
      c.avgCost = Decimal.max(ZERO, c.avgCost.minus(op.amount.abs()));
    } else if (PAYOUT.has(op.type)) {
      c.payoutsTotal = c.payoutsTotal.plus(op.amount);
    }
  }

  const positions: Position[] = [];
  const lots: Lot[] = [];
  for (const c of cells.values()) {
    if (c.isCash) {
      positions.push({
        instrumentId: c.instrumentId,
        tagId: c.tagId,
        quantity: c.balance,
        costBasis: c.balance,
        avgPrice: new Decimal(1),
        realizedPnl: ZERO,
        payoutsTotal: c.payoutsTotal,
        firstBuyAt: null,
        costCurrency: null,
        isCash: true,
      });
      continue;
    }
    lots.push(...c.lots);
    const open = c.lots.filter((l) => l.remaining.gt(0));
    const quantity = open.reduce((s, l) => s.plus(l.remaining), ZERO);
    const costBasis = open.reduce((s, l) => s.plus(l.remaining.times(l.unitCost)), ZERO);
    const priced = open.reduce((s, l) => s.plus(l.remaining.times(l.unitPrice)), ZERO);
    positions.push({
      instrumentId: c.instrumentId,
      tagId: c.tagId,
      quantity,
      costBasis,
      avgPrice: quantity.isZero() ? ZERO : priced.div(quantity),
      realizedPnl: c.realizedPnl,
      payoutsTotal: c.payoutsTotal,
      firstBuyAt: c.firstBuyAt,
      costCurrency: c.lots[0]?.currency ?? null,
      isCash: false,
    });
  }
  return { positions, lots, closures, sales, issues };
}

/** value = quantity × price, unrealized = value − cost basis, and its share of the cost in percent. */
export function unrealized(position: Pick<Position, 'quantity' | 'costBasis'>, price: Decimal) {
  const value = position.quantity.times(price);
  const result = value.minus(position.costBasis);
  return {
    value,
    unrealized: result,
    unrealizedPct: position.costBasis.isZero() ? ZERO : result.div(position.costBasis).times(100),
  };
}
