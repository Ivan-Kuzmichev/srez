import { Decimal } from './decimal';
import type { LedgerContext, LedgerOperation } from './ledger-types';
import { resolveTag } from './positions';
import type { Scope } from './scope';

export interface FlowOperation extends LedgerOperation {
  accountId: string;
}

export interface ExternalFlow {
  operationId: string;
  at: Date;
  /** Into the area is positive, in rubles at the rate of the operation's day. */
  amountRub: Decimal;
}

const ZERO = new Decimal(0);

/**
 * External flows of an area (docs/04-calculations.md, section 3): what changes its value other than
 * the market. A trade inside the area is not a flow; buying a security in the area with money from
 * outside it is. Accruals never are. `rubPer(currency, at)` gives the CBR rate of that day.
 */
export function externalFlows(
  operations: readonly FlowOperation[],
  ctxByAccount: ReadonlyMap<string, LedgerContext>,
  inScope: Scope,
  rubPer: (currency: string, at: Date) => Decimal,
  /** «Учитывать свободный кэш» off: cash cells are outside the area, money moves in and out with trades. */
  options: { includeCash?: boolean } = {},
): ExternalFlow[] {
  const flows: ExternalFlow[] = [];
  for (const op of operations) {
    if (op.voided) continue;
    const ctx = ctxByAccount.get(op.accountId);
    if (!ctx) continue;
    const cashIn = options.includeCash !== false && inScope(op.accountId, ctx.accountDefaultTagId);
    const securityTag = op.instrumentId ? resolveTag(op.instrumentId, op.tagId, ctx) : null;
    const securityIn = op.instrumentId ? inScope(op.accountId, securityTag) : false;
    const rub = (v: Decimal) => v.times(rubPer(op.currency, op.executedAt));

    let flow = ZERO;
    switch (op.type) {
      case 'deposit':
      case 'withdrawal':
        // Money arrives in or leaves the account's cash cell.
        if (cashIn) flow = op.amount;
        break;
      case 'transfer_in':
        if (securityIn) flow = op.quantity.times(op.price);
        break;
      case 'transfer_out':
        if (securityIn) flow = op.quantity.times(op.price).neg();
        break;
      case 'buy':
      case 'sell':
      case 'redemption':
      case 'dividend':
      case 'coupon':
      case 'interest':
      case 'amortization':
        // Money crossing between a security inside the area and cash outside it.
        if (securityIn && !cashIn) flow = op.amount.neg();
        else if (!securityIn && cashIn && op.instrumentId) flow = op.amount;
        break;
      case 'fee':
      case 'tax':
        if (op.instrumentId && securityIn && !cashIn) flow = op.amount.neg();
        break;
      default:
        break; // accruals, currency exchange inside the cash cell, splits: not flows
    }
    if (!flow.isZero()) flows.push({ operationId: op.id, at: op.executedAt, amountRub: rub(flow) });
  }
  return flows;
}

/** «Вложено»: the sum of flows from the start (docs/04-calculations.md, section 3). */
export function invested(flows: readonly ExternalFlow[], until?: Date): Decimal {
  return flows.filter((f) => !until || f.at <= until).reduce((s, f) => s.plus(f.amountRub), ZERO);
}

/** Change over a day: Δ = V_today − V_yesterday − F_today, Δ% = Δ / V_yesterday (section 6). */
export function dayChange(valueToday: Decimal, valueYesterday: Decimal, flowToday: Decimal) {
  const change = valueToday.minus(valueYesterday).minus(flowToday);
  return { change, pct: valueYesterday.isZero() ? null : change.div(valueYesterday).times(100) };
}
