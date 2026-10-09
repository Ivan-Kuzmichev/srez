import { describe, expect, it } from 'vitest';
import { Money } from '@/domain/money';
import {
  approx,
  formatChange,
  formatCrypto,
  formatDate,
  formatDateYear,
  formatDateLong,
  formatMoney,
  formatHolding,
  formatMonthAxis,
  formatMonthRange,
  formatMonthYear,
  formatPercent,
  formatPlain,
  formatSigned,
  formatShareOfTarget,
  formatPp,
  formatQuantity,
  formatTime,
  formatTradeAmount,
  orNone,
} from './format';

// Spaces in expectations are written as   where the formatter must not break the line.
const nb = (s: string) => s.replace(/ /g, ' ');

describe('money in summaries', () => {
  it('rounds to the ruble, groups thousands, puts the symbol after', () => {
    expect(formatMoney(Money.of('4812360.4', 'RUB'))).toBe(nb('4 812 360 ₽'));
    expect(formatMoney(Money.of('999.5', 'RUB'))).toBe(nb('1 000 ₽'));
    expect(formatMoney(Money.of('12', 'USD'))).toBe(nb('12 $'));
    expect(formatMoney(Money.of('12', 'EUR'))).toBe(nb('12 €'));
    expect(formatMoney(Money.of('12', 'CNY'))).toBe(nb('12 CNY'));
  });

  it('uses U+2212 for negatives and never prints minus zero', () => {
    expect(formatMoney(Money.of('-16400', 'RUB'))).toBe(nb('−16 400 ₽'));
    expect(formatMoney(Money.of('-0.4', 'RUB'))).toBe(nb('0 ₽'));
  });
});

describe('amounts in trades', () => {
  it('shows kopecks with a comma', () => {
    expect(formatTradeAmount('312.1')).toBe('312,10');
    expect(formatTradeAmount('1234567.005')).toBe(nb('1 234 567,01'));
    expect(formatTradeAmount('-5')).toBe('−5,00');
  });
});

describe('changes', () => {
  it('always carry a sign', () => {
    expect(formatChange(Money.of(12480, 'RUB'))).toBe(nb('+12 480 ₽'));
    expect(formatChange(Money.of(-16400, 'RUB'))).toBe(nb('−16 400 ₽'));
    expect(formatChange(Money.of('0.2', 'RUB'))).toBe(nb('0 ₽'));
  });
});

describe('percent and points', () => {
  it('formats percent with one decimal and a space before %', () => {
    expect(formatPercent(13.44, { signed: true })).toBe(nb('+13,4 %'));
    expect(formatPercent('-2.05', { signed: true })).toBe(nb('−2,1 %'));
    expect(formatPercent(32.2)).toBe(nb('32,2 %'));
    expect(formatPercent(0.26, { signed: true, digits: 2 })).toBe(nb('+0,26 %'));
    expect(formatPercent(1234.5)).toBe(nb('1 234,5 %'));
  });

  it('formats percentage points', () => {
    expect(formatPp(3.1)).toBe(nb('+3,1 п.п.'));
    expect(formatPp(-0.04)).toBe(nb('0,0 п.п.'));
  });
});

describe('plain numbers and targets', () => {
  it('formats a bare number and fact against target', () => {
    expect(formatPlain('100', 0)).toBe('100');
    expect(formatSigned('52920.4')).toBe(nb('+52 920'));
    expect(formatSigned('-16400')).toBe(nb('−16 400'));
    expect(formatPlain('1234.56', 1)).toBe(nb('1 234,6'));
    expect(formatShareOfTarget('38.37', '40')).toBe('38,4 / 40\u00a0%');
    expect(formatShareOfTarget('8.3', null)).toBe('8,3 / 0\u00a0%');
  });
});

describe('quantities', () => {
  it('formats securities as integers with an optional unit', () => {
    expect(formatQuantity(1200)).toBe(nb('1 200'));
    expect(formatQuantity('1200', { unit: true })).toBe(nb('1 200 шт'));
    expect(formatQuantity('2.5')).toBe('2,5');
  });

  it('formats crypto to at least three significant digits without extra zeros', () => {
    expect(formatCrypto('0.062')).toBe('0,0620');
    expect(formatCrypto('0.95')).toBe('0,950');
    expect(formatCrypto('0.0720')).toBe('0,0720');
    expect(formatCrypto('1.5')).toBe('1,50');
    expect(formatCrypto('12.5')).toBe('12,5');
    expect(formatCrypto('1234.56789')).toBe(nb('1 234,56789'));
    expect(formatCrypto('0.123456789123')).toBe('0,12345679');
    expect(formatCrypto('0')).toBe('0');
    expect(formatCrypto('-0.5')).toBe('−0,500');
  });
});

describe('dates and time', () => {
  const ts = new Date('2026-10-05T16:25:00Z');

  it('formats in the display time zone', () => {
    expect(formatDate(ts, 'Europe/Moscow')).toBe(nb('5 окт'));
    expect(formatDateYear(ts, 'Europe/Moscow')).toBe(nb('5 окт 2026'));
    expect(formatTime(ts, 'Europe/Moscow')).toBe('19:25');
    expect(formatTime(new Date('2026-10-05T23:30:00Z'), 'UTC')).toBe('23:30');
  });

  it('crosses the date line by zone', () => {
    const late = new Date('2026-12-31T22:00:00Z');
    expect(formatDateYear(late, 'UTC')).toBe(nb('31 дек 2026'));
    expect(formatDateYear(late, 'Europe/Moscow')).toBe(nb('1 янв 2027'));
  });

  it('writes the full month, adding the year only for other years', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    expect(formatDateLong(new Date('2026-09-12T10:00:00Z'), 'UTC', now)).toBe(nb('12 сентября'));
    expect(formatDateLong(new Date('2025-05-01T10:00:00Z'), 'UTC', now)).toBe(nb('1 мая 2025'));
  });

  it('uses the genitive short month names', () => {
    const months = Array.from({ length: 12 }, (_, m) =>
      formatDate(new Date(Date.UTC(2026, m, 1, 12)), 'UTC'),
    );
    expect(months.map((s) => s.split(' ')[1])).toEqual([
      'янв',
      'фев',
      'мар',
      'апр',
      'мая',
      'июн',
      'июл',
      'авг',
      'сен',
      'окт',
      'ноя',
      'дек',
    ]);
  });
});

describe('helpers', () => {
  it('writes the word for a missing value and marks approximations', () => {
    expect(orNone(null, formatPercent)).toBe('нет');
    expect(orNone(5, formatPercent)).toBe(nb('5,0 %'));
    expect(approx(nb('78 600 ₽'))).toBe(nb('≈ 78 600 ₽'));
  });
});

describe('months', () => {
  it('names a month, a range and an axis tick', () => {
    expect(formatMonthYear('2026-03')).toBe('Март 2026');
    expect(formatMonthRange('2026-02-03', '2026-04-02')).toBe('Февраль–апрель');
    expect(formatMonthRange('2026-03-01', '2026-03-20')).toBe('Март');
    expect(formatMonthRange('2025-11-01', '2026-02-01')).toBe('Ноябрь 2025 – февраль 2026');
    expect(formatMonthAxis('2026-05-10')).toBe('май');
  });
});

describe('holding periods', () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  it('years and months, days under a month', () => {
    expect(formatHolding(d('2026-02-26'), d('2026-09-26'))).toBe('7\u00a0месяцев');
    expect(formatHolding(d('2025-05-14'), d('2026-07-14'))).toBe('1\u00a0год 2\u00a0месяца');
    expect(formatHolding(d('2024-05-03'), d('2026-06-03'))).toBe('2\u00a0года 1\u00a0месяц');
    expect(formatHolding(d('2023-01-01'), d('2026-01-01'))).toBe('3\u00a0года');
    expect(formatHolding(d('2026-09-20'), d('2026-10-02'))).toBe('12\u00a0дней');
  });
});
