import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { guessReason, reconcile, type Holding } from './reconcile';

const d = (v: string | number) => new Decimal(v);
const h = (instrumentId: string, quantity: string | number): Holding => ({
  instrumentId,
  quantity: d(quantity),
});
const today = '2026-10-08';

describe('reconcile (04, section 14)', () => {
  it('finds nothing when the journal matches, within 1e-9', () => {
    const out = reconcile(
      [h('a', 10), h('b', '0.1000000001')],
      [h('a', 10), h('b', '0.1')],
      new Map(),
      new Set(),
      today,
    );
    expect(out).toEqual([]);
  });

  it('reports both sides, sums cells of one instrument, skips the excluded', () => {
    const out = reconcile(
      [h('a', 6), h('a', 4), h('gone', 3), h('skip', 1)],
      [h('a', 11), h('new', 5), h('skip', 2)],
      new Map(),
      new Set(['skip']),
      today,
    );
    expect(out.map((x) => [x.instrumentId, x.ledgerQty.toString(), x.brokerQty.toString()])).toEqual([
      ['a', '10', '11'],
      ['gone', '3', '0'],
      ['new', '0', '5'],
    ]);
  });

  it('guesses the reason, most specific first', () => {
    expect(guessReason(d(100), d(90), { kind: 'currency' }, today)).toBe('fx');
    expect(guessReason(d(20), d(0), { kind: 'bond', maturityDate: '2026-03-25' }, today)).toBe('redemption');
    // Not matured yet: an ordinary unknown.
    expect(guessReason(d(20), d(0), { kind: 'bond', maturityDate: '2041-05-15' }, today)).toBe('unknown');
    expect(guessReason(d(18), d(180), { kind: 'share' }, today)).toBe('split');
    expect(guessReason(d(100), d(10), { kind: 'share' }, today)).toBe('split');
    expect(guessReason(d(10), d(15), { kind: 'share' }, today)).toBe('transfer');
    expect(guessReason(d(0), d(15), { kind: 'share' }, today)).toBe('transfer');
    expect(guessReason(d(162), d(360), { kind: 'share' }, today)).toBe('transfer');
    expect(guessReason(d(15), d(10), { kind: 'share' }, today)).toBe('unknown');
    expect(guessReason(d(5), d(0), { kind: 'share' }, today)).toBe('unknown');
  });
});
