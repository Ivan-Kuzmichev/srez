import { createHash } from 'node:crypto';
import { Decimal } from '@/domain/decimal';
import type { OperationType } from '@/domain/ledger-types';
import { currencyOf, quotation, type OperationItem } from './client';

/**
 * Broker operations → journal entries (docs/05-integrations.md, section 1, «Соответствие типов»).
 * Pure: the importer resolves instruments and accounts, fills redemption quantities and writes.
 */

export interface InstrumentRef {
  uid: string;
  /** The same security across trading modes (TRUR and TRUR@ share it); the best identity key. */
  positionUid: string;
  figi: string;
  ticker: string;
  classCode: string;
  /** `INSTRUMENT_TYPE_…` */
  kind: string;
  /** "share", "bond", "etf", "currency", or empty in old operations. */
  type: string;
  name: string;
}

export interface MappedOperation {
  /**
   * `<broker account>:<operation id>`: broker ids are unique per account only (both sides of a
   * transfer between own accounts share one). Entries derived from one operation get a suffix (`:card`).
   */
  externalId: string;
  /** Stable across a change of the broker's id: account, time, type, instrument, payment, quantity. */
  fingerprint: string;
  brokerAccountId: string;
  type: OperationType;
  executedAt: Date;
  instrument: InstrumentRef | null;
  quantity: Decimal;
  price: Decimal;
  currency: string;
  /** Net cash effect, fee and tax included, as the journal stores it. */
  amount: Decimal;
  fee: Decimal;
  tax: Decimal;
  accruedInterest: Decimal;
  /** Full redemption arrives without a quantity: the importer takes what the account held. */
  quantityFromHolding: boolean;
  /** A broker fee whose trade is outside this batch: attach to it if it exists, else keep as a fee. */
  parentExternalId: string | null;
  note: string | null;
  /** The broker operations behind this entry, for the `raw` column. */
  raw: OperationItem[];
}

export interface MapWarning {
  externalId: string;
  brokerType: string;
  reason: 'UNKNOWN_TYPE' | 'UNSUPPORTED_TYPE' | 'NOT_FILLED';
}

const T = (s: string) => `OPERATION_TYPE_${s}`;
const set = (...names: string[]) => new Set(names.map(T));

const BUY = set('BUY', 'BUY_MARGIN', 'DELIVERY_BUY');
const SELL = set('SELL', 'SELL_CARD', 'SELL_MARGIN', 'DELIVERY_SELL');
const DEPOSIT = set('INPUT', 'INPUT_SWIFT', 'INPUT_ACQUIRING', 'INP_MULTI');
const WITHDRAWAL = set('OUTPUT', 'OUTPUT_SWIFT', 'OUTPUT_ACQUIRING', 'OUT_MULTI');
const DIVIDEND = set('DIVIDEND', 'DIVIDEND_TRANSFER');
const FEE = set(
  'SERVICE_FEE',
  'MARGIN_FEE',
  'SUCCESS_FEE',
  'TRACK_MFEE',
  'TRACK_PFEE',
  'CASH_FEE',
  'OUT_FEE',
  'OUT_STAMP_DUTY',
  'OUTPUT_PENALTY',
  'ADVICE_FEE',
  'OVER_COM',
);
const PAYOUT_TAX = set('BOND_TAX', 'BOND_TAX_PROGRESSIVE', 'DIVIDEND_TAX', 'DIVIDEND_TAX_PROGRESSIVE');
const TAX = set(
  'TAX',
  'TAX_PROGRESSIVE',
  'BENEFIT_TAX',
  'BENEFIT_TAX_PROGRESSIVE',
  'TAX_REPO',
  'TAX_REPO_PROGRESSIVE',
  'TAX_REPO_HOLD',
  'TAX_REPO_HOLD_PROGRESSIVE',
  'TAX_CORRECTION',
  'TAX_CORRECTION_PROGRESSIVE',
  'TAX_CORRECTION_COUPON',
  'TAX_REPO_REFUND',
  'TAX_REPO_REFUND_PROGRESSIVE',
);
const INTEREST = set('OVERNIGHT', 'OVER_INCOME');
const TRANSFER = set('TRANS_IIS_BS', 'TRANS_BS_BS');
/** Known, but nothing in the journal fits them; kept as `other` with a warning. */
const OTHER = set(
  'UNSPECIFIED',
  'OVER_PLACEMENT',
  'ACCRUING_VARMARGIN',
  'WRITING_OFF_VARMARGIN',
  'OPTION_EXPIRATION',
  'FUTURE_EXPIRATION',
);

const ZERO = new Decimal(0);

function instrumentOf(o: OperationItem): InstrumentRef | null {
  if (!o.instrumentUid && !o.figi) return null;
  return {
    uid: o.instrumentUid,
    positionUid: o.positionUid,
    figi: o.figi,
    ticker: o.ticker,
    classCode: o.classCode,
    kind: o.instrumentKind,
    type: o.instrumentType,
    name: o.name,
  };
}

const isCurrency = (o: OperationItem) =>
  o.instrumentKind === 'INSTRUMENT_TYPE_CURRENCY' || o.instrumentType === 'currency';

export function fingerprint(o: OperationItem, suffix = ''): string {
  const parts = [
    o.brokerAccountId,
    o.date.toISOString(),
    o.type,
    o.instrumentUid || o.figi,
    quotation(o.payment).toString(),
    o.quantity,
    suffix,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

export const externalIdOf = (o: Pick<OperationItem, 'brokerAccountId' | 'id'>, suffix = '') =>
  `${o.brokerAccountId}:${o.id}${suffix ? `:${suffix}` : ''}`;

function entry(
  o: OperationItem,
  type: OperationType,
  fields: Partial<MappedOperation> = {},
): MappedOperation {
  return {
    externalId: externalIdOf(o),
    fingerprint: fingerprint(o),
    brokerAccountId: o.brokerAccountId,
    type,
    executedAt: o.date,
    instrument: instrumentOf(o),
    quantity: ZERO,
    price: ZERO,
    currency: currencyOf(o.payment) || 'RUB',
    amount: quotation(o.payment),
    fee: ZERO,
    tax: ZERO,
    accruedInterest: ZERO,
    quantityFromHolding: false,
    parentExternalId: null,
    note: null,
    raw: [o],
    ...fields,
  };
}

const filled = (o: OperationItem) => new Decimal(o.quantity).minus(o.quantityRest);
const abs = (q: OperationItem['price']) => quotation(q).abs();
const day = (d: Date) => d.toISOString().slice(0, 10);

export function mapOperations(items: OperationItem[]): {
  operations: MappedOperation[];
  warnings: MapWarning[];
} {
  const executed = items.filter((o) => o.state === 'OPERATION_STATE_EXECUTED');
  const out: MappedOperation[] = [];
  const byExternalId = new Map<string, MappedOperation>();
  const warnings: MapWarning[] = [];
  const fees: OperationItem[] = [];
  const payoutTaxes: OperationItem[] = [];
  /** DIV_EXT: the withdrawal of the net dividend is built after its tax is attached. */
  const toCard: MappedOperation[] = [];
  const push = (m: MappedOperation) => {
    out.push(m);
    byExternalId.set(m.externalId, m);
    return m;
  };

  for (const o of executed) {
    const t = o.type;
    if (t === T('BROKER_FEE')) fees.push(o);
    else if (PAYOUT_TAX.has(t)) payoutTaxes.push(o);
    else if (BUY.has(t) || t === T('BUY_CARD') || SELL.has(t)) {
      const quantity = filled(o);
      if (quantity.lte(0)) {
        warnings.push({ externalId: o.id, brokerType: t, reason: 'NOT_FILLED' });
        continue;
      }
      const buying = !SELL.has(t);
      const type: OperationType = isCurrency(o) ? (buying ? 'fx_buy' : 'fx_sell') : buying ? 'buy' : 'sell';
      push(entry(o, type, { quantity, price: abs(o.price), accruedInterest: abs(o.accruedInt) }));
    } else if (DIVIDEND.has(t) || t === T('DIV_EXT')) {
      const m = push(entry(o, 'dividend'));
      if (t === T('DIV_EXT')) toCard.push(m);
    } else if (t === T('COUPON')) push(entry(o, 'coupon'));
    else if (t === T('BOND_REPAYMENT_FULL')) {
      const quantity = new Decimal(o.quantity);
      push(
        entry(o, 'redemption', {
          quantity,
          price: quantity.gt(0) ? quotation(o.payment).div(quantity) : ZERO,
          quantityFromHolding: quantity.isZero(),
        }),
      );
    } else if (t === T('BOND_REPAYMENT')) push(entry(o, 'amortization'));
    else if (DEPOSIT.has(t)) push(entry(o, 'deposit', { instrument: null }));
    else if (WITHDRAWAL.has(t)) push(entry(o, 'withdrawal', { instrument: null }));
    else if (t === T('INPUT_SECURITIES') || t === T('OUTPUT_SECURITIES')) {
      const type = t === T('INPUT_SECURITIES') ? 'transfer_in' : 'transfer_out';
      push(entry(o, type, { quantity: new Decimal(o.quantity), price: abs(o.price), amount: ZERO }));
    } else if (TRANSFER.has(t)) {
      const payment = quotation(o.payment);
      if (o.instrumentUid || new Decimal(o.quantity).gt(0)) {
        // Between own accounts, as a pair: the payment is the valuation, not money.
        const type = payment.lt(0) ? 'transfer_out' : 'transfer_in';
        push(entry(o, type, { quantity: new Decimal(o.quantity), price: abs(o.price), amount: ZERO }));
      } else push(entry(o, payment.lt(0) ? 'withdrawal' : 'deposit', { instrument: null }));
    } else if (FEE.has(t)) push(entry(o, 'fee', { fee: quotation(o.payment).neg() }));
    else if (TAX.has(t)) push(entry(o, 'tax', { tax: quotation(o.payment).neg() }));
    else if (INTEREST.has(t)) push(entry(o, 'interest'));
    else {
      warnings.push({
        externalId: o.id,
        brokerType: t,
        reason: OTHER.has(t) ? 'UNSUPPORTED_TYPE' : 'UNKNOWN_TYPE',
      });
      push(entry(o, 'other', { note: o.description || o.name || t }));
    }
  }

  // Broker fees go into the trade they belong to.
  for (const f of fees) {
    const amount = quotation(f.payment);
    const parent = byExternalId.get(
      externalIdOf({ brokerAccountId: f.brokerAccountId, id: f.parentOperationId }),
    );
    if (parent && parent.raw[0]!.brokerAccountId === f.brokerAccountId) {
      parent.fee = parent.fee.minus(amount);
      parent.amount = parent.amount.plus(amount);
      parent.raw.push(f);
    } else
      push(
        entry(f, 'fee', {
          fee: amount.neg(),
          parentExternalId: f.parentOperationId
            ? externalIdOf({ brokerAccountId: f.brokerAccountId, id: f.parentOperationId })
            : null,
        }),
      );
  }

  // Coupon and dividend taxes come without a link: the payout of the same security that day, nearest in time.
  const payouts = out.filter((m) => m.type === 'dividend' || m.type === 'coupon');
  for (const tx of payoutTaxes) {
    const amount = quotation(tx.payment);
    const candidates = payouts
      .filter(
        (p) =>
          p.brokerAccountId === tx.brokerAccountId &&
          p.instrument &&
          (p.instrument.uid === tx.instrumentUid || (p.instrument.figi && p.instrument.figi === tx.figi)) &&
          day(p.executedAt) === day(tx.date) &&
          p.currency === (currencyOf(tx.payment) || 'RUB'),
      )
      .sort(
        (a, b) =>
          Number(a.tax.gt(0)) - Number(b.tax.gt(0)) ||
          Math.abs(a.executedAt.getTime() - tx.date.getTime()) -
            Math.abs(b.executedAt.getTime() - tx.date.getTime()),
      );
    const payout = candidates[0];
    if (payout) {
      payout.tax = payout.tax.minus(amount);
      payout.amount = payout.amount.plus(amount);
      payout.raw.push(tx);
    } else push(entry(tx, 'tax', { tax: amount.neg() }));
  }

  for (const d of toCard) {
    const o = d.raw[0]!;
    push(
      entry(o, 'withdrawal', {
        externalId: externalIdOf(o, 'card'),
        fingerprint: fingerprint(o, 'card'),
        instrument: null,
        amount: d.amount.neg(),
        note: o.description || null,
      }),
    );
  }

  out.sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime() || a.externalId.localeCompare(b.externalId),
  );
  return { operations: out, warnings };
}
