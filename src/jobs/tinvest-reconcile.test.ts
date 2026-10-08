import { Writable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { createTinvestSource } from '@/db/mutations/sources';
import { discrepancies, instruments, operations, reconcileExclusions, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { TinvestClient } from '@/integrations/tinvest/client';
import { createLogger } from '@/server/logger';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { reconcileAccount } from './tinvest-reconcile';
import { syncSource } from './tinvest-sync';

const log = createLogger({
  level: 'error',
  getDb: createTestDb,
  console: new Writable({ write: (_c, _e, cb) => cb() }),
}).root;
const now = new Date('2026-10-08T12:00:00Z');
let mock: TinvestMock;
beforeAll(async () => {
  mock = await startTinvestMock();
});
afterAll(() => mock.close());

async function synced() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const sourceId = createTinvestSource(db, 'u1', MOCK_TOKEN);
  const client = new TinvestClient(MOCK_TOKEN, { baseUrl: mock.url, sleep: async () => {} });
  const ids = saveBrokerAccounts(
    db,
    'u1',
    sourceId,
    await client.getAccounts({ includeClosed: true }),
    () => true,
  );
  await syncSource(db, sourceId, { client, trigger: 'manual', now, log });
  const idOf = (isin: string) =>
    db.select({ id: instruments.id }).from(instruments).where(eq(instruments.isin, isin)).get()!.id;
  const a1 = ids.get('2000000001')!;
  const again = () => reconcileAccount(db, client, { id: a1, externalId: '2000000001' }, now, '2026-10-08');
  return { db, sourceId, a1, idOf, again };
}

describe('reconcile after sync', () => {
  it('opens a discrepancy for each artificial difference and nothing else', async () => {
    const { db, a1, idOf } = await synced();
    const rows = db.select().from(discrepancies).all();
    expect(
      rows
        .map((r) => [r.accountId === a1, r.instrumentId, r.ledgerQty, r.brokerQty, r.guess, r.status])
        .sort(),
    ).toEqual(
      [
        [true, idOf('RU0007661625'), '0', '50', 'transfer', 'open'],
        [true, idOf('RU0009024277'), '1', '10', 'split', 'open'],
      ].sort(),
    );
  });

  it('keeps one active discrepancy per pair and refreshes it', async () => {
    const { db, again } = await synced();
    await again();
    await again();
    expect(db.select().from(discrepancies).all()).toHaveLength(2);
  });

  it('resolves a discrepancy when the journal catches up, and keeps a snoozed one snoozed', async () => {
    const { db, sourceId, a1, idOf, again } = await synced();
    const lkoh = idOf('RU0009024277');
    db.update(discrepancies).set({ status: 'snoozed' }).where(eq(discrepancies.instrumentId, lkoh)).run();
    db.insert(operations)
      .values({
        userId: 'u1',
        accountId: a1,
        instrumentId: idOf('RU0007661625'),
        type: 'transfer_in',
        executedAt: now,
        quantity: '50',
        price: '125',
        currency: 'RUB',
        origin: 'reconcile',
        sourceId,
      })
      .run();
    await again();
    const byId = (id: string) =>
      db.select().from(discrepancies).where(eq(discrepancies.instrumentId, id)).get()!;
    expect(byId(idOf('RU0007661625'))).toMatchObject({ status: 'resolved', resolvedAt: now });
    expect(byId(lkoh).status).toBe('snoozed');
  });

  it('leaves out excluded securities and marks their discrepancy ignored', async () => {
    const { db, a1, idOf, again } = await synced();
    const gazp = idOf('RU0007661625');
    db.insert(reconcileExclusions).values({ accountId: a1, instrumentId: gazp }).run();
    const result = await again();
    expect(result.open).toBe(1);
    expect(
      db
        .select()
        .from(discrepancies)
        .where(and(eq(discrepancies.instrumentId, gazp)))
        .get()?.status,
    ).toBe('ignored');
  });
});
