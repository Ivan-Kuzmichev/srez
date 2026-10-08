import { Decimal, type DecimalValue } from './decimal';

/** ISO 4217 code or a crypto ticker, upper case. */
export type Currency = string;

const CURRENCY = /^[A-Z0-9]{2,10}$/;

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Currency mismatch: ${a} and ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

/** An amount in one currency. Immutable; mixing currencies throws. */
export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: Currency,
  ) {}

  static of(amount: DecimalValue, currency: Currency): Money {
    if (!CURRENCY.test(currency)) throw new Error(`Invalid currency: ${currency}`);
    const value = new Decimal(amount);
    if (!value.isFinite()) throw new Error(`Invalid amount: ${String(amount)}`);
    return new Money(value, currency);
  }

  static zero(currency: Currency): Money {
    return Money.of(0, currency);
  }

  /** Sum of a list in one currency; an empty list gives zero. */
  static sum(items: readonly Money[], currency: Currency): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  private same(other: Money): void {
    if (other.currency !== this.currency) throw new CurrencyMismatchError(this.currency, other.currency);
  }

  add(other: Money): Money {
    this.same(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  sub(other: Money): Money {
    this.same(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  mul(factor: DecimalValue): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  div(divisor: DecimalValue): Money {
    return new Money(this.amount.div(divisor), this.currency);
  }

  /** Ratio of two amounts in the same currency, e.g. a share of the portfolio. */
  ratio(other: Money): Decimal {
    this.same(other);
    return this.amount.div(other.amount);
  }

  /** Converts by `rate` = units of `to` per one unit of this currency. */
  convert(rate: DecimalValue, to: Currency): Money {
    return Money.of(this.amount.times(rate), to);
  }

  neg(): Money {
    return new Money(this.amount.neg(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  compare(other: Money): -1 | 0 | 1 {
    this.same(other);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  /** «123.45 RUB», for logs and debugging; use lib/format for the interface. */
  toString(): string {
    return `${this.amount.toFixed()} ${this.currency}`;
  }
}
