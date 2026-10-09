import { Decimal } from './decimal';

/** docs/04-calculations.md, section 10. */
const ZERO = new Decimal(0);

/** A token whose balance grows: today − yesterday − what came in + what went out. */
export function rebasingAccrual(args: {
  yesterday: Decimal;
  today: Decimal;
  inflows: Decimal;
  outflows: Decimal;
}): Decimal {
  return args.today.minus(args.yesterday).minus(args.inflows).plus(args.outflows);
}

/** A wrapper whose rate grows: quantity × (rate today − rate yesterday), in the base coin. */
export function wrappedAccrual(args: {
  quantity: Decimal;
  rateYesterday: Decimal;
  rateToday: Decimal;
}): Decimal {
  return args.quantity.times(args.rateToday.minus(args.rateYesterday));
}

/** «Начислено до подключения»: the balance now minus everything that came in, plus what went out. */
export function accruedBeforeConnection(args: {
  current: Decimal;
  inflows: Decimal;
  outflows: Decimal;
}): Decimal {
  return args.current.minus(args.inflows).plus(args.outflows);
}

/** How an accrual is booked: positive — `accrual`, negative (a penalty, slashing) — `other`, zero — nothing. */
export function accrualKind(amount: Decimal): 'accrual' | 'other' | null {
  if (amount.gt(0)) return 'accrual';
  if (amount.lt(0)) return 'other';
  return null;
}

/** Sum of transfer quantities, for the in and out sides of a day. */
export function sumOf(values: readonly Decimal[]): Decimal {
  return values.reduce((s, v) => s.plus(v), ZERO);
}
