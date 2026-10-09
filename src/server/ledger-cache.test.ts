import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { finAccounts, operations, sources, tags, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { memoByLedger } from './ledger-cache';

describe('ledger cache', () => {
  it('builds again only when the journal or what the replay depends on changed', () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(user)
      .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
      .run();
    const src = db
      .insert(sources)
      .values({ userId: 'u1', kind: 'manual', name: 'Вручную' })
      .returning()
      .get();
    const acc = db
      .insert(finAccounts)
      .values({ userId: 'u1', sourceId: src.id, name: 'Б', kind: 'broker', currency: 'RUB' })
      .returning()
      .get();
    let builds = 0;
    const read = () => memoByLedger(db, 'u1', 'test', () => ++builds);
    expect(read()).toBe(1);
    expect(read()).toBe(1);
    db.insert(operations)
      .values({
        userId: 'u1',
        accountId: acc.id,
        sourceId: src.id,
        origin: 'manual',
        type: 'deposit',
        amount: '100',
        currency: 'RUB',
        executedAt: now,
      })
      .run();
    expect(read()).toBe(2);
    const tag = db.insert(tags).values({ userId: 'u1', name: 'пенсия' }).returning().get();
    db.update(finAccounts).set({ defaultTagId: tag.id }).where(eq(finAccounts.id, acc.id)).run();
    expect(read()).toBe(3);
    expect(read()).toBe(3);
  });
});
