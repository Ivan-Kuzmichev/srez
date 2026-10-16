import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import type { OperationType } from './ledger-types';
import { planSplits } from './splits';

const op = (date: string, type: OperationType, q: string) => ({
  at: new Date(`${date}T12:00:00Z`),
  type,
  quantity: new Decimal(q),
});
const split = (date: string, from: string, to: string) => ({
  at: new Date(`${date}T12:00:00Z`),
  from: new Decimal(from),
  to: new Decimal(to),
});

describe('planSplits', () => {
  it('applies each split to the holding on its date, trades in between included', () => {
    // 10 shares, 1 → 4 in 2021 (40), 5 more bought (45), 1 → 10 in 2024 (450).
    const ops = [op('2020-05-01', 'buy', '10'), op('2023-03-01', 'buy', '5')];
    const plan = planSplits(ops, [split('2024-06-10', '1', '10'), split('2021-07-20', '1', '4')]);
    expect(plan).toEqual({ ok: true, deltas: [new Decimal(405), new Decimal(30)], final: new Decimal(450) });
  });

  it('takes a consolidation away', () => {
    const plan = planSplits([op('2020-01-01', 'buy', '100')], [split('2022-01-01', '10', '1')]);
    expect(plan.ok && [plan.deltas[0]!.toString(), plan.final.toString()]).toEqual(['-90', '10']);
  });

  it('a sale after a split counts post-split shares', () => {
    const ops = [op('2020-01-01', 'buy', '10'), op('2022-01-01', 'sell', '15')];
    const plan = planSplits(ops, [split('2021-01-01', '1', '2')]);
    expect(plan.ok && plan.final.toString()).toBe('5');
  });

  it('refuses a split with nothing held on its date', () => {
    const plan = planSplits([op('2023-01-01', 'buy', '10')], [split('2022-01-01', '1', '4')]);
    expect(plan).toEqual({ ok: false, code: 'NO_POSITION', index: 0 });
  });
});
