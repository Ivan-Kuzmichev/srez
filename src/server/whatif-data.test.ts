import { describe, expect, it } from 'vitest';
import { recalcAccount } from '@/db/mutations/positions';
import { rebuildAccountSnapshots } from '@/db/mutations/snapshots';
import { keyRates, prices } from '@/db/schema';
import { insertOperation, seedAccount, seedShare } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import { ensureBenchmarks } from './benchmarks';
import { everything, loadFx, loadUserLedger } from './portfolio-data';
import { whatIfData } from './whatif-data';

const tz = 'Europe/Moscow';
const now = new Date('2026-01-20T12:00:00Z');

function setup() {
  const db = createTestDb();
  seedAccount(db);
  seedShare(db, 'sber', 'SBER');
  const at = (d: string) => new Date(`${d}T09:00:00Z`);
  insertOperation(db, { type: 'deposit', amount: '100000', executedAt: at('2026-01-01') });
  insertOperation(db, { type: 'deposit', amount: '50000', executedAt: at('2026-01-10') });
  insertOperation(db, { type: 'withdrawal', amount: '-22000', executedAt: at('2026-01-20') });
  recalcAccount(db, 'a1');
  rebuildAccountSnapshots(db, 'a1', '2026-01-19', tz);
  const mcftr = ensureBenchmarks(db).get('MCFTR')!;
  db.insert(prices)
    .values([
      { instrumentId: mcftr, date: '2026-01-01', close: '1000', currency: 'RUB', source: 'moex' },
      { instrumentId: mcftr, date: '2026-01-10', close: '1250', currency: 'RUB', source: 'moex' },
      { instrumentId: mcftr, date: '2026-01-20', close: '1100', currency: 'RUB', source: 'moex' },
    ])
    .run();
  return db;
}

const run = (
  db: ReturnType<typeof setup>,
  choice: Parameters<typeof whatIfData>[7],
  rate: string | null = null,
) =>
  whatIfData(
    db,
    'u1',
    everything,
    loadUserLedger(db, 'u1'),
    loadFx(db),
    new Decimal(128000),
    tz,
    choice,
    rate ? new Decimal(rate) : null,
    now,
  )!;

describe('«А если бы»', () => {
  it('the same deposits and withdrawals into the index: эталон 15.1 against the live value', () => {
    const w = run(setup(), 'MCFTR');
    expect(w.from).toBe('2026-01-01');
    expect(w.alt.toFixed()).toBe('132000');
    expect(w.actual.toFixed()).toBe('128000');
    expect(w.diff.toFixed()).toBe('-4000');
    // Every snapshot day and today, each with both values.
    expect(w.points.map((p) => p.date)).toEqual(
      Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`),
    );
    expect(w.points[0]!.actual.toFixed()).toBe('100000');
    expect(w.points[0]!.alt.toFixed()).toBe('100000');
  });

  it('a deposit at its own rate, at the key rate by day, and nothing to compare with yet', () => {
    const db = setup();
    // 14 600 a year on 100 000 is 40 a day; the second deposit adds 20 a day from the 11th.
    const own = run(db, 'deposit', '14.6');
    expect(own.missing).toBe(false);
    expect(own.alt.gt(128000)).toBe(true);
    expect(run(db, 'key').missing).toBe(true);
    db.insert(keyRates).values({ date: '2025-12-19', rate: '14.6' }).run();
    expect(run(db, 'key').alt.toFixed()).toBe(own.alt.toFixed());
  });

  it("options: a payout sent to a card stays the portfolio's; the key rate less the bank gap", () => {
    const db = setup();
    // 10 Jan: a dividend of 1 000 the broker sent straight to a card.
    insertOperation(db, {
      type: 'withdrawal',
      amount: '-1000',
      executedAt: new Date('2026-01-10T10:00:00Z'),
      origin: 'tinvest',
      externalId: '2000000001:div-1:card',
    });
    db.insert(keyRates).values({ date: '2025-12-19', rate: '14.6' }).run();
    const ledger = loadUserLedger(db, 'u1');
    const base = (options: Parameters<typeof whatIfData>[10]) =>
      whatIfData(
        db,
        'u1',
        everything,
        ledger,
        loadFx(db),
        new Decimal(128000),
        tz,
        'key',
        null,
        now,
        options,
      )!;
    const plain = base(undefined);
    const kept = base({ payoutsToCard: true, compound: true, adjustPct: new Decimal(0) });
    // The portfolio is worth 1 000 more, the deposit withdrew 1 000 less (plus the interest on it).
    expect(kept.keptPayouts.toFixed()).toBe('1000');
    expect(kept.actual.minus(plain.actual).toFixed()).toBe('1000');
    expect(kept.alt.gt(plain.alt.plus(1000))).toBe(true);
    // 2 points under the key rate and no capitalization: less than the plain key rate.
    const bank = base({ payoutsToCard: false, compound: false, adjustPct: new Decimal(2) });
    expect(bank.alt.lt(plain.alt)).toBe(true);
    expect(bank.keptPayouts.toFixed()).toBe('0');
  });
});
