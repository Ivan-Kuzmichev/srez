import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { finAccounts, instruments, operations, sources, user } from './schema';

/** Owner, a manual source and one RUB account. */
export function seedAccount(db: Db, ids = { user: 'u1', source: 's1', account: 'a1' }) {
  const now = new Date();
  db.insert(user)
    .values({
      id: ids.user,
      name: 'owner',
      email: 'owner@local.invalid',
      username: 'owner',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(sources).values({ id: ids.source, userId: ids.user, kind: 'manual', name: 'Вручную' }).run();
  db.insert(finAccounts)
    .values({
      id: ids.account,
      userId: ids.user,
      sourceId: ids.source,
      name: 'Брокерский',
      kind: 'broker',
      currency: 'RUB',
    })
    .run();
  return ids;
}

export function seedShare(db: Db, id = 'sber', ticker = 'SBER') {
  db.insert(instruments)
    .values({ id, kind: 'share', assetClass: 'stocks', ticker, name: ticker, currency: 'RUB' })
    .run();
  return id;
}

export function cashId(db: Db, code: string): string {
  return db.select({ id: instruments.id }).from(instruments).where(eq(instruments.ticker, code)).get()!.id;
}

let n = 0;
export function insertOperation(
  db: Db,
  fields: Partial<typeof operations.$inferInsert> & Pick<typeof operations.$inferInsert, 'type'>,
): string {
  n += 1;
  const id = fields.id ?? `op-${n}`;
  db.insert(operations)
    .values({
      userId: 'u1',
      accountId: 'a1',
      sourceId: 's1',
      origin: 'manual',
      currency: 'RUB',
      executedAt: new Date(Date.UTC(2026, 0, n)),
      ...fields,
      id,
    })
    .run();
  return id;
}
