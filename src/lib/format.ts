/**
 * Every number and date in the interface goes through these functions (docs/08-ui.md, section 7).
 * Rounding happens only here, half away from zero.
 */
import { Decimal, type DecimalValue } from '@/domain/decimal';
import type { Currency, Money } from '@/domain/money';
import { ru } from './i18n/ru';

const NBSP = ' ';
const MINUS = '−';

const CURRENCY_SYMBOL: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

export function currencySymbol(currency: Currency): string {
  return CURRENCY_SYMBOL[currency] ?? currency;
}

/** Fixed decimals, thousands grouped with a non-breaking space, decimal comma, U+2212 minus. */
function formatNumber(value: DecimalValue, decimals: number, sign: 'auto' | 'always' = 'auto'): string {
  const rounded = new Decimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  const zero = rounded.isZero();
  const [int = '0', frac] = rounded.abs().toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const body = frac ? `${grouped},${frac}` : grouped;
  if (zero) return body;
  if (rounded.isNegative()) return `${MINUS}${body}`;
  return sign === 'always' ? `+${body}` : body;
}

const withCurrency = (number: string, currency: Currency) => `${number}${NBSP}${currencySymbol(currency)}`;

/** Summary amount, to the whole unit: «4 812 360 ₽». */
export function formatMoney(money: Money): string {
  return withCurrency(formatNumber(money.amount, 0), money.currency);
}

/** Change, always signed: «+12 480 ₽», «−16 400 ₽». */
export function formatChange(money: Money): string {
  return withCurrency(formatNumber(money.amount, 0, 'always'), money.currency);
}

/** Price or amount in a trade row, to kopecks, no symbol: «312,10». */
export function formatTradeAmount(value: DecimalValue): string {
  return formatNumber(value, 2);
}

/** Same as formatTradeAmount with the currency symbol: «312,10 ₽». */
export function formatTradeMoney(money: Money): string {
  return withCurrency(formatNumber(money.amount, 2), money.currency);
}

export interface PercentOptions {
  signed?: boolean;
  digits?: number;
}

/** Value already in percent: 13.4 → «13,4 %», signed → «+13,4 %». */
export function formatPercent(value: DecimalValue, options: PercentOptions = {}): string {
  return `${formatNumber(value, options.digits ?? 1, options.signed ? 'always' : 'auto')}${NBSP}%`;
}

/** Percentage points, always signed: «+3,1 п.п.». */
export function formatPp(value: DecimalValue): string {
  return `${formatNumber(value, 1, 'always')}${NBSP}п.п.`;
}

/** Securities count: integer with grouping, «шт» where there is no column header. */
export function formatQuantity(value: DecimalValue, options: { unit?: boolean } = {}): string {
  const d = new Decimal(value);
  const number = formatNumber(d, Math.min(d.decimalPlaces(), 8));
  return options.unit ? `${number}${NBSP}шт` : number;
}

const CRYPTO_MIN_SIGNIFICANT = 3;
const CRYPTO_MAX_DECIMALS = 8;

/** Crypto amount: significant digits without trailing zeros, padded to three significant: «0,0620». */
export function formatCrypto(value: DecimalValue): string {
  const d = new Decimal(value);
  if (d.isZero()) return '0';
  const magnitude = d.abs().log(10).floor().toNumber() + 1;
  const minDecimals = Math.max(0, CRYPTO_MIN_SIGNIFICANT - magnitude);
  const decimals = Math.min(CRYPTO_MAX_DECIMALS, Math.max(d.decimalPlaces(), minDecimals));
  return formatNumber(d, decimals);
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function dateParts(date: Date, timeZone: string) {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour ?? '00',
    minute: parts.minute ?? '00',
  };
}

/** «5 окт» in the display time zone. */
export function formatDate(date: Date, timeZone: string): string {
  const p = dateParts(date, timeZone);
  return `${p.day}${NBSP}${MONTHS[p.month - 1]}`;
}

/** «5 окт 2026». */
export function formatDateYear(date: Date, timeZone: string): string {
  const p = dateParts(date, timeZone);
  return `${p.day}${NBSP}${MONTHS[p.month - 1]}${NBSP}${p.year}`;
}

/** «19:25», 24-hour. */
export function formatTime(date: Date, timeZone: string): string {
  const p = dateParts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** A missing value is a word, not a dash: «нет». */
export function orNone<T>(value: T | null | undefined, format: (v: T) => string): string {
  return value === null || value === undefined ? ru.common.none : format(value);
}

/** «≈ 78 600 ₽». */
export function approx(formatted: string): string {
  return `≈${NBSP}${formatted}`;
}
