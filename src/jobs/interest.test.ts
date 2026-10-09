import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recalcAccount } from '@/db/mutations/positions';
import { instruments, operations } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { insertOperation, seedAccount } from '@/db/test-fixtures';
import { accrueInterest } from './interest';

function setup() {
  const db = createTestDb();
  seedAccount(db);
  db.insert(instruments)
    .values({
      id: 'deposit',
      kind: 'custom',
      assetClass: 'cash',
      name: 'Вклад «Подушка»',
      currency: 'RUB',
      userId: 'u1',
      meta: { valuation: 'interest', annualRate: '16' },
    })
    .run();
  insertOperation(db, {
    type: 'buy',
    accountId: 'a1',
    instrumentId: 'deposit',
    quantity: '1',
    price: '210000',
    amount: '-210000',
    executedAt: new Date('2026-01-15T09:00:00Z'),
  });
  recalcAccount(db, 'a1');
  return db;
}
const interest = (db: ReturnType<typeof setup>) =>
  db
    .select()
    .from(operations)
    .where(and(eq(operations.instrumentId, 'deposit'), eq(operations.type, 'interest')))
    .orderBy(operations.executedAt)
    .all();

describe('interest on custom assets (04, section 9; reference 9.2)', () => {
  it('adds 2 800 a month on the opening day, once', () => {
    const db = setup();
    expect(accrueInterest(db, new Date('2026-04-20T12:00:00Z'))).toBe(3);
    const rows = interest(db);
    expect(
      rows.map((r) => [r.executedAt.toISOString().slice(0, 10), r.amount, r.origin, r.externalId]),
    ).toEqual([
      ['2026-02-15', '2800', 'manual', 'interest:a1:deposit:2026-02'],
      ['2026-03-15', '2800', 'manual', 'interest:a1:deposit:2026-03'],
      ['2026-04-15', '2800', 'manual', 'interest:a1:deposit:2026-04'],
    ]);
    expect(accrueInterest(db, new Date('2026-04-20T12:00:00Z'))).toBe(0);
    expect(accrueInterest(db, new Date('2026-05-15T12:00:00Z'))).toBe(1);
  });

  it('starts after interest typed by hand, and skips assets valued by hand', () => {
    const db = setup();
    insertOperation(db, {
      type: 'interest',
      accountId: 'a1',
      instrumentId: 'deposit',
      amount: '2800',
      executedAt: new Date('2026-03-15T09:00:00Z'),
    });
    expect(accrueInterest(db, new Date('2026-04-20T12:00:00Z'))).toBe(1);
    expect(interest(db).map((r) => r.executedAt.toISOString().slice(0, 10))).toEqual([
      '2026-03-15',
      '2026-04-15',
    ]);
    db.update(instruments)
      .set({ meta: { valuation: 'manual', annualRate: null } })
      .run();
    expect(accrueInterest(db, new Date('2026-09-20T12:00:00Z'))).toBe(0);
  });
});
