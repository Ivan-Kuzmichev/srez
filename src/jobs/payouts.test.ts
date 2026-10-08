import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { recalcAccount } from '@/db/mutations/positions';
import { createTinvestSource } from '@/db/mutations/sources';
import { finAccounts, instruments, payoutEvents, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { TinvestClient } from '@/integrations/tinvest/client';
import { createLogger } from '@/server/logger';
import { loadFx, loadValuedCells, upcomingPayouts } from '@/server/portfolio-data';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { refreshPayouts } from './payouts';
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
  saveBrokerAccounts(db, 'u1', sourceId, await client.getAccounts({ includeClosed: true }), () => true);
  await syncSource(db, sourceId, { client, trigger: 'manual', now, log });
  for (const a of db.select({ id: finAccounts.id }).from(finAccounts).all()) recalcAccount(db, a.id);
  const idOf = (isin: string) =>
    db.select({ id: instruments.id }).from(instruments).where(eq(instruments.isin, isin)).get()!.id;
  return { db, client, idOf };
}

describe('payout schedules', () => {
  it('stores coupons and declared dividends of held securities, once', async () => {
    const { db, client, idOf } = await synced();
    await refreshPayouts(db, client, log, now);
    const rows = db.select().from(payoutEvents).all();
    const ofz = rows.filter((r) => r.instrumentId === idOf('RU000A1038V6'));
    // A month back, a year ahead: the coupons of 13 January and 14 July 2027.
    expect(ofz.map((r) => [r.kind, r.payDate, r.amountPerUnit])).toEqual([
      ['coupon', '2027-01-13', '35.65'],
      ['coupon', '2027-07-14', '35.65'],
    ]);
    const sber = rows.filter((r) => r.instrumentId === idOf('RU0009029540'));
    expect(sber.map((r) => [r.kind, r.payDate, r.recordDate, r.amountPerUnit])).toEqual([
      ['dividend', '2026-10-28', '2026-10-18', '36.5'],
    ]);
    // The redeemed bond is not held any more: nothing is asked for it.
    expect(rows.some((r) => r.instrumentId === idOf('RU000A101N52'))).toBe(false);

    await refreshPayouts(db, client, log, now);
    expect(db.select().from(payoutEvents).all()).toHaveLength(rows.length);
  });

  it('shows the next payouts with amounts for the current holding', async () => {
    const { db, client } = await synced();
    await refreshPayouts(db, client, log, now);
    const cells = loadValuedCells(db, 'u1', loadFx(db));
    const next = upcomingPayouts(db, cells, '2026-10-08');
    expect(next.map((p) => [p.payDate, p.name, p.kind, p.amount.toString(), p.currency])).toEqual([
      ['2026-10-28', 'Сбер Банк', 'dividend', '2920', 'RUB'],
      ['2027-01-13', 'ОФЗ 26238', 'coupon', '356.5', 'RUB'],
      ['2027-07-14', 'ОФЗ 26238', 'coupon', '356.5', 'RUB'],
    ]);
    expect(upcomingPayouts(db, cells, '2027-08-01')).toEqual([]);
  });
});
