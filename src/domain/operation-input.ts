import { Decimal } from './decimal';
import type { Ledger, LedgerContext, LedgerOperation, OperationType } from './ledger-types';
import { buildLedger, resolveTag } from './positions';

/** The five choices of the operation form (OperationForm mockup). */
export type FormKind = 'trade' | 'payout' | 'cashflow' | 'charge';
export type TradeSide = 'buy' | 'sell';

export type OperationDraft =
  | { kind: 'trade'; side: TradeSide; quantity: Decimal; price: Decimal; fee: Decimal }
  | { kind: 'payout'; type: 'dividend' | 'coupon' | 'interest'; gross: Decimal; tax: Decimal }
  | { kind: 'cashflow'; type: 'deposit' | 'withdrawal'; total: Decimal }
  | { kind: 'charge'; type: 'fee' | 'tax'; total: Decimal };

export interface OperationFields {
  type: OperationType;
  quantity: Decimal;
  price: Decimal;
  amount: Decimal;
  fee: Decimal;
  tax: Decimal;
}

const ZERO = new Decimal(0);

/** Signed cash effect and stored fields for a draft: minus means money left the account. */
export function draftToFields(draft: OperationDraft): OperationFields {
  switch (draft.kind) {
    case 'trade': {
      const gross = draft.quantity.times(draft.price);
      return {
        type: draft.side,
        quantity: draft.quantity,
        price: draft.price,
        amount: draft.side === 'buy' ? gross.plus(draft.fee).neg() : gross.minus(draft.fee),
        fee: draft.fee,
        tax: ZERO,
      };
    }
    case 'payout':
      return {
        type: draft.type,
        quantity: ZERO,
        price: ZERO,
        amount: draft.gross.minus(draft.tax),
        fee: ZERO,
        tax: draft.tax,
      };
    case 'cashflow':
      return {
        type: draft.type,
        quantity: ZERO,
        price: ZERO,
        amount: draft.type === 'deposit' ? draft.total : draft.total.neg(),
        fee: ZERO,
        tax: ZERO,
      };
    case 'charge':
      return {
        type: draft.type,
        quantity: ZERO,
        price: ZERO,
        amount: draft.total.neg(),
        fee: draft.type === 'fee' ? draft.total : ZERO,
        tax: draft.type === 'tax' ? draft.total : ZERO,
      };
  }
}

/** «Сумма сделки» shown under the fields: the absolute cash effect. */
export function draftTotal(draft: OperationDraft): Decimal {
  return draftToFields(draft).amount.abs();
}

export interface CellPreview {
  quantityBefore: Decimal;
  quantityAfter: Decimal;
  avgPriceBefore: Decimal | null;
  avgPriceAfter: Decimal | null;
}

function cellOf(ledger: Ledger, instrumentId: string, tagId: string | null) {
  return ledger.positions.find((p) => p.instrumentId === instrumentId && p.tagId === tagId);
}

/**
 * «Что изменится» (FR-OPS-4): the position and average price of the affected cell before and after.
 * `existing` are the account's operations without the one being edited.
 */
export function previewChange(
  existing: readonly LedgerOperation[],
  candidate: LedgerOperation,
  ctx: LedgerContext,
): CellPreview | null {
  if (!candidate.instrumentId) return null;
  const tagId = resolveTag(candidate.instrumentId, candidate.tagId, ctx);
  const before = cellOf(buildLedger(existing, ctx), candidate.instrumentId, tagId);
  const after = cellOf(buildLedger([...existing, candidate], ctx), candidate.instrumentId, tagId);
  const avg = (p: typeof before) => (p && p.quantity.gt(0) ? p.avgPrice : null);
  return {
    quantityBefore: before?.quantity ?? ZERO,
    quantityAfter: after?.quantity ?? ZERO,
    avgPriceBefore: avg(before),
    avgPriceAfter: avg(after),
  };
}
