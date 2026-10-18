import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { depositView, goalYear, leadingBlanks, levelOf, type DayDeposit } from './deposit-goal';

const D = (v: number | string) => new Decimal(v);
const dep = (date: string, amount: number): DayDeposit => ({ date, amount: D(amount) });

describe('«Цель пополнений»', () => {
  it('a goal year from any month', () => {
    expect(goalYear('2026-10-18', 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(goalYear('2026-10-18', 9)).toEqual({ from: '2026-09-01', to: '2027-08-31' });
    expect(goalYear('2026-03-05', 9)).toEqual({ from: '2025-09-01', to: '2026-08-31' });
  });

  it('levels: nothing, under half, half or more, the goal', () => {
    expect([0, 12000, 15000, 30000, 45000].map((v) => levelOf(D(v), D(30000)))).toEqual([0, 1, 2, 3, 3]);
    expect(levelOf(D(100), D(0))).toBe(0);
  });

  it('a month goal: 7 of 9 months on plan, 252 000 in the year (docs/04, 18)', () => {
    const amounts = [30000, 30000, 15000, 30000, 0, 45000, 30000, 30000, 30000, 12000];
    const deposits = amounts.flatMap((a, i) =>
      a ? [dep(`2026-${String(i + 1).padStart(2, '0')}-10`, a)] : [],
    );
    // Last year's deposit and a future-dated one stay out.
    deposits.push(dep('2025-12-20', 99999), dep('2026-10-25', 5000));
    const v = depositView(deposits, { amount: D(30000), period: 'month', yearStart: 1 }, '2026-10-18');
    if (v.kind !== 'month') throw new Error(v.kind);
    expect([v.met, v.counted, v.total.toFixed()]).toEqual([7, 9, '252000']);
    expect(v.cells.map((c) => c.level).join('')).toBe('332303333100');
    expect(v.cells.map((c) => c.state[0]).join('')).toBe('pppppppppcff');
  });

  it('the current month counts once it reached the goal', () => {
    const v = depositView(
      [dep('2026-10-01', 30000)],
      { amount: D(30000), period: 'month', yearStart: 10 },
      '2026-10-18',
    );
    if (v.kind !== 'month') throw new Error(v.kind);
    expect([v.met, v.counted]).toEqual([1, 1]);
    expect(v.cells[0]!.date).toBe('2026-10-01');
    expect(v.cells[11]!.date).toBe('2027-09-01');
  });

  it('a day goal: 15 of 18 days, 8 250 of 9 000 in October', () => {
    const deposits: DayDeposit[] = [];
    for (let d = 1; d <= 18; d++) {
      const amount = d === 4 || d === 11 ? 0 : d === 7 ? 250 : d === 14 ? 1000 : 500;
      if (amount) deposits.push(dep(`2026-10-${String(d).padStart(2, '0')}`, amount));
    }
    deposits.push(dep('2026-09-30', 500));
    const v = depositView(deposits, { amount: D(500), period: 'day', yearStart: 1 }, '2026-10-18');
    if (v.kind !== 'day') throw new Error(v.kind);
    expect([v.met, v.counted, v.total.toFixed(), v.due.toFixed()]).toEqual([15, 18, '8250', '9000']);
    expect(v.cells).toHaveLength(31);
    expect([v.cells[17]!.state, v.cells[18]!.state, v.cells[6]!.level]).toEqual(['current', 'future', 2]);
    // 1 October 2026 is a Thursday.
    expect(leadingBlanks(v.month)).toBe(3);
  });

  it('a year goal: 310 000 of 400 000 on 18 October, behind the even pace', () => {
    const v = depositView(
      [dep('2026-02-01', 200000), dep('2026-06-01', 110000)],
      { amount: D(400000), period: 'year', yearStart: 1 },
      '2026-10-18',
    );
    if (v.kind !== 'year') throw new Error(v.kind);
    expect([v.deposited.toFixed(), v.left.toFixed(), v.to]).toEqual(['310000', '90000', '2026-12-31']);
    // 291 days of 365.
    expect(v.elapsed.toFixed(3)).toBe('0.797');
    expect(v.behind.toFixed(0)).toBe('8904');
    expect(v.slices.map((s) => s.toFixed(1)).join(' ')).toBe(
      '1.0 1.0 1.0 1.0 1.0 1.0 1.0 1.0 1.0 0.3 0.0 0.0',
    );
    const over = depositView(
      [dep('2026-01-10', 500000)],
      { amount: D(400000), period: 'year', yearStart: 1 },
      '2026-10-18',
    );
    if (over.kind !== 'year') throw new Error(over.kind);
    expect([over.left.toFixed(), over.behind.lt(0), over.slices.every((s) => s === 1)]).toEqual([
      '0',
      true,
      true,
    ]);
  });

  it('no goal: the months against the largest one', () => {
    const v = depositView([dep('2026-02-01', 10000), dep('2026-05-01', 4000)], null, '2026-10-18');
    if (v.kind !== 'none') throw new Error(v.kind);
    expect(v.cells.map((c) => c.level).join('')).toBe('030010000000');
    expect(v.total.toFixed()).toBe('14000');
    const empty = depositView([], null, '2026-10-18');
    expect(empty.kind === 'none' && empty.cells.every((c) => c.level === 0)).toBe(true);
  });
});
