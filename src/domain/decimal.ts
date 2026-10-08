import DecimalJs from 'decimal.js';

/**
 * Decimal for all money, prices, quantities and rates. Precision covers numeric(38, 18) with room
 * to spare; exponent notation is off so toString() is always a plain decimal string for storage.
 */
export const Decimal = DecimalJs.clone({
  precision: 50,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -60,
  toExpPos: 60,
});
export type Decimal = InstanceType<typeof Decimal>;
export type DecimalValue = Decimal | string | number;

/** Plain decimal string for a `text` column: no exponent, no trailing zeros. */
export function toDbDecimal(value: DecimalValue): string {
  return new Decimal(value).toFixed();
}

export function fromDbDecimal(value: string): Decimal {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`Not a decimal string: ${value}`);
  return new Decimal(value);
}
