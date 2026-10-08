import { describe, expect, it } from 'vitest';
import { listManualAccounts, listTags } from '@/db/queries/accounts';
import { sources, user } from '@/db/schema';
import { insertOperation } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { createManualAccount, createTag } from './accounts';

function setup() {
  const db = createTestDb();
  const now = new Date();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  db.insert(user)
    .values({ id: 'u2', name: 'x', email: 'x@local.invalid', createdAt: now, updatedAt: now })
    .run();
  return db;
}

describe('manual accounts', () => {
  it('share one manual source and list with counts', () => {
    const db = setup();
    const wallet = createManualAccount(db, 'u1', {
      name: 'Кошелёк',
      kind: 'wallet',
      currency: 'RUB',
      defaultTagId: null,
    });
    createManualAccount(db, 'u1', { name: 'Вклад', kind: 'deposit', currency: 'RUB', defaultTagId: null });
    expect(db.select().from(sources).all()).toHaveLength(1);

    const sourceId = db.select().from(sources).get()!.id;
    insertOperation(db, { type: 'deposit', amount: '100', accountId: wallet, sourceId, userId: 'u1' });
    insertOperation(db, { type: 'deposit', amount: '50', accountId: wallet, sourceId, userId: 'u1' });
    const list = listManualAccounts(db, 'u1');
    expect(list.map((a) => [a.name, a.operations])).toEqual([
      ['Вклад', 0],
      ['Кошелёк', 2],
    ]);
    expect(list[1]!.lastOperationAt).toBeInstanceOf(Date);
    expect(listManualAccounts(db, 'u2')).toEqual([]);
  });

  it("refuse someone else's tag as the default", () => {
    const db = setup();
    const foreign = createTag(db, 'u2', 'чужой');
    expect(() =>
      createManualAccount(db, 'u1', { name: 'X', kind: 'other', currency: 'RUB', defaultTagId: foreign.id }),
    ).toThrow();
  });
});

describe('tags', () => {
  it('are unique per user by name', () => {
    const db = setup();
    const a = createTag(db, 'u1', 'пенсия');
    expect(createTag(db, 'u1', 'пенсия').id).toBe(a.id);
    expect(createTag(db, 'u2', 'пенсия').id).not.toBe(a.id);
    expect(listTags(db, 'u1')).toEqual([{ id: a.id, name: 'пенсия' }]);
  });
});
