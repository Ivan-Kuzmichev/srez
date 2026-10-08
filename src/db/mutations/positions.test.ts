import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { lotClosures, lots, operations, positions } from '@/db/schema';
import { cashId, insertOperation, seedAccount, seedShare } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { recalcAccount } from './positions';

function setup() {
  const db = createTestDb();
  seedAccount(db);
  seedShare(db);
  return db;
}

const buy = (qty: number, price: string) => ({
  type: 'buy' as const,
  instrumentId: 'sber',
  quantity: String(qty),
  price,
  amount: `-${(qty * Number(price)).toFixed(2)}`,
});

describe('recalcAccount', () => {
  it('writes the reference 1.1 position and is idempotent', () => {
    const db = setup();
    insertOperation(db, buy(500, '251.00'));
    insertOperation(db, buy(400, '271.20'));
    insertOperation(db, buy(200, '284.45'));
    insertOperation(db, buy(100, '312.10'));

    recalcAccount(db, 'a1');
    const first = db.select().from(positions).where(eq(positions.instrumentId, 'sber')).get()!;
    expect(first).toMatchObject({ quantity: '1200', costBasis: '322080', avgPrice: '268.4' });
    expect(db.select().from(lots).all()).toHaveLength(4);

    recalcAccount(db, 'a1');
    expect(db.select().from(positions).all()).toHaveLength(2); // SBER and RUB cash
    expect(db.select().from(lots).all()).toHaveLength(4);
    const cash = db
      .select()
      .from(positions)
      .where(eq(positions.instrumentId, cashId(db, 'RUB')))
      .get()!;
    expect(cash.quantity).toBe('-322080');
  });

  it('follows a deleted operation and rewrites closures', () => {
    const db = setup();
    insertOperation(db, buy(10, '100'));
    insertOperation(db, buy(10, '120'));
    const sell = insertOperation(db, {
      type: 'sell',
      instrumentId: 'sber',
      quantity: '15',
      price: '130',
      amount: '1950',
    });
    recalcAccount(db, 'a1');
    expect(db.select().from(lotClosures).all()).toHaveLength(2);
    expect(db.select().from(positions).where(eq(positions.instrumentId, 'sber')).get()?.realizedPnl).toBe(
      '350',
    );

    db.delete(operations).where(eq(operations.id, sell)).run();
    recalcAccount(db, 'a1');
    expect(db.select().from(lotClosures).all()).toHaveLength(0);
    expect(db.select().from(positions).where(eq(positions.instrumentId, 'sber')).get()).toMatchObject({
      quantity: '20',
      realizedPnl: '0',
    });
  });

  it('creates a cash instrument for a currency it has not seen', () => {
    const db = setup();
    insertOperation(db, { type: 'deposit', amount: '100', currency: 'GBP' });
    recalcAccount(db, 'a1');
    expect(
      db
        .select()
        .from(positions)
        .where(eq(positions.instrumentId, cashId(db, 'GBP')))
        .get()?.quantity,
    ).toBe('100');
  });
});
