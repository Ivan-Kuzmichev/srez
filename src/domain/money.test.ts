import { describe, expect, it } from 'vitest';
import { Decimal, fromDbDecimal, toDbDecimal } from './decimal';
import { CurrencyMismatchError, Money } from './money';

describe('Money', () => {
  it('adds without float error', () => {
    expect(Money.of('0.1', 'RUB').add(Money.of('0.2', 'RUB')).equals(Money.of('0.3', 'RUB'))).toBe(true);
  });

  it('refuses to mix currencies', () => {
    expect(() => Money.of(1, 'RUB').add(Money.of(1, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => Money.of(1, 'RUB').compare(Money.of(1, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('keeps 18 decimal places for crypto', () => {
    const wei = Money.of('0.000000000000000001', 'ETH');
    expect(wei.mul(3).amount.toFixed()).toBe('0.000000000000000003');
  });

  it('sums, converts and compares', () => {
    const total = Money.sum([Money.of(100, 'USD'), Money.of('50.5', 'USD')], 'USD');
    expect(total.toString()).toBe('150.5 USD');
    expect(total.convert('92.5', 'RUB').toString()).toBe('13921.25 RUB');
    expect(Money.of(1, 'RUB').compare(Money.of(2, 'RUB'))).toBe(-1);
    expect(Money.sum([], 'EUR').isZero()).toBe(true);
    expect(Money.of('-0', 'RUB').isNegative()).toBe(false);
  });

  it('rejects bad input', () => {
    expect(() => Money.of('abc', 'RUB')).toThrow();
    expect(() => Money.of(Infinity, 'RUB')).toThrow();
    expect(() => Money.of(1, 'rub')).toThrow();
  });
});

describe('decimal storage', () => {
  it('round-trips through a plain string without exponent', () => {
    const tiny = new Decimal('1e-18');
    expect(toDbDecimal(tiny)).toBe('0.000000000000000001');
    expect(toDbDecimal('12345678901234567890.123456789012345678')).toBe(
      '12345678901234567890.123456789012345678',
    );
    expect(fromDbDecimal('-12.50').toFixed()).toBe('-12.5');
    expect(() => fromDbDecimal('1e5')).toThrow();
  });
});
