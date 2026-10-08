import type { Decimal } from './decimal';

export type OperationType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'coupon'
  | 'interest'
  | 'accrual'
  | 'deposit'
  | 'withdrawal'
  | 'fee'
  | 'tax'
  | 'transfer_in'
  | 'transfer_out'
  | 'fx_buy'
  | 'fx_sell'
  | 'redemption'
  | 'amortization'
  | 'split'
  | 'other';

/** One journal entry as the calculations see it. Money and quantities are Decimals. */
export interface LedgerOperation {
  id: string;
  type: OperationType;
  executedAt: Date;
  createdAt: Date;
  instrumentId: string | null;
  /** Always ≥ 0; the type gives the direction. */
  quantity: Decimal;
  /** Per unit, in `currency`. */
  price: Decimal;
  currency: string;
  /** Signed cash effect in `currency`: negative means money left the account. */
  amount: Decimal;
  fee: Decimal;
  tax: Decimal;
  accruedInterest: Decimal;
  /** Explicit tag on the operation, before rules. */
  tagId: string | null;
  voided: boolean;
}

export interface LedgerContext {
  /** Tag rules of the account: instrument id → tag id. */
  tagRules: ReadonlyMap<string, string>;
  /** fin_accounts.default_tag_id */
  accountDefaultTagId: string | null;
  /** Cash instrument id for a currency code, e.g. RUB → the built-in «Рубли». */
  cashInstrumentId(currency: string): string;
  /** Count the fee into the lot cost and out of sale proceeds (settings.returns.deductFees). */
  deductFees: boolean;
}

export interface Lot {
  openOperationId: string;
  instrumentId: string;
  tagId: string | null;
  openedAt: Date;
  quantity: Decimal;
  remaining: Decimal;
  unitCost: Decimal;
  /** Clean purchase price per unit, for the displayed average price. */
  unitPrice: Decimal;
  /** Currency of unitCost and unitPrice: the currency of the opening trade. */
  currency: string;
}

export interface LotClosure {
  lot: Lot;
  closeOperationId: string;
  closedAt: Date;
  quantity: Decimal;
  cost: Decimal;
  proceeds: Decimal;
  pnl: Decimal;
  holdingDays: number;
}

export interface Position {
  instrumentId: string;
  tagId: string | null;
  quantity: Decimal;
  costBasis: Decimal;
  avgPrice: Decimal;
  realizedPnl: Decimal;
  payoutsTotal: Decimal;
  firstBuyAt: Date | null;
  /** Currency of costBasis and avgPrice (the trades'); for cash, the cash currency. */
  costCurrency: string | null;
  /** Cash cells keep a running balance instead of lots. */
  isCash: boolean;
}

export interface LedgerIssue {
  operationId: string;
  code: 'OVERSOLD' | 'NO_POSITION' | 'MISSING_INSTRUMENT' | 'ZERO_PRICE' | 'MIXED_CURRENCY';
}

export interface Ledger {
  positions: Position[];
  lots: Lot[];
  closures: LotClosure[];
  issues: LedgerIssue[];
}
