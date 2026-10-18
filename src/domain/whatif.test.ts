import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { intoDeposit, intoIndex } from './whatif';

const D = (v: string | number) => new Decimal(v);
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

describe('эталон 15.1: в индекс', () => {
  it('units bought and sold at the day close: 120 units at 1 100 = 132 000', () => {
    const v = intoIndex(
      [
        { date: '2026-01-01', amount: D(100000) },
        { date: '2026-01-10', amount: D(50000) },
        { date: '2026-01-20', amount: D(-22000) },
      ],
      [
        { date: '2026-01-01', close: '1000' },
        { date: '2026-01-10', close: '1250' },
        { date: '2026-01-20', close: '1100' },
      ],
      days('2026-01-01', '2026-01-20'),
    );
    expect(v.find((d) => d.date === '2026-01-05')!.value.toFixed()).toBe('100000');
    // Between closes the last one counts: 140 units at 1 250.
    expect(v.find((d) => d.date === '2026-01-15')!.value.toFixed()).toBe('175000');
    expect(v.at(-1)!.value.toFixed()).toBe('132000');
  });

  it('a flow before the index history buys at its first close; no history gives nothing', () => {
    const v = intoIndex(
      [{ date: '2025-12-30', amount: D(1000) }],
      [{ date: '2026-01-02', close: '10' }],
      ['2025-12-30', '2026-01-02'],
    );
    expect(v.map((d) => d.value.toFixed())).toEqual(['1000', '1000']);
    expect(intoIndex([{ date: '2026-01-01', amount: D(1) }], [], ['2026-01-01'])).toEqual([]);
  });
});

describe('эталон 15.2: на вклад', () => {
  it('100 000 at 12 %: 30 days of January credited on the 31st, 100 986,30', () => {
    const v = intoDeposit(
      [{ date: '2026-01-01', amount: D(100000) }],
      () => D(12),
      days('2026-01-01', '2026-02-01'),
    );
    expect(v[0]!.value.toFixed()).toBe('100000');
    expect(v.find((d) => d.date === '2026-01-31')!.value.toFixed(2)).toBe('100986.30');
    // February accrues on the capitalized balance.
    expect(v.at(-1)!.value.toFixed(2)).toBe('101019.50');
  });

  it('the rate of each day; a withdrawal leaves the balance at once', () => {
    const rate = (d: string) => D(d < '2026-01-16' ? 10 : 20);
    const v = intoDeposit(
      [
        { date: '2026-01-01', amount: D(36500) },
        { date: '2026-01-21', amount: D(-36500) },
      ],
      rate,
      days('2026-01-01', '2026-01-31'),
    );
    // 14 days at 10 % (10 a day), 6 days at 20 % (20 a day) on 36 500; nothing left to accrue after.
    expect(v.at(-1)!.value.toFixed()).toBe('260');
  });
});

describe('«А если бы»: поправки', () => {
  it('an index fee of 1 % a year takes 1 % over a year of a flat price', () => {
    const v = intoIndex(
      [{ date: '2025-01-01', amount: D(100000) }],
      [{ date: '2025-01-01', close: '100' }],
      days('2025-01-01', '2026-01-01'),
      D(1),
    );
    expect(v.at(-1)!.value.toFixed(2)).toBe('99000.00');
  });

  it('without capitalization the interest earns nothing; a negative rate counts as none', () => {
    const simple = intoDeposit(
      [{ date: '2026-01-01', amount: D(100000) }],
      () => D(12),
      days('2026-01-01', '2026-03-31'),
      false,
    );
    // 89 days at 12 % on 100 000, never on the interest.
    expect(simple.at(-1)!.value.toFixed(2)).toBe('102926.03');
    const compound = intoDeposit(
      [{ date: '2026-01-01', amount: D(100000) }],
      () => D(12),
      days('2026-01-01', '2026-03-31'),
    );
    expect(compound.at(-1)!.value.gt(simple.at(-1)!.value)).toBe(true);
    expect(
      intoDeposit([{ date: '2026-01-01', amount: D(100) }], () => D(-3), days('2026-01-01', '2026-01-10'))
        .at(-1)!
        .value.toFixed(),
    ).toBe('100');
  });
});
