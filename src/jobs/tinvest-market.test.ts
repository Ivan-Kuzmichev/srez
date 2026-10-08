import { Writable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { createTinvestSource } from '@/db/mutations/sources';
import { instruments, prices, pricesLast, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import type { Fetch } from '@/integrations/errors';
import { TinvestClient } from '@/integrations/tinvest/client';
import { createLogger } from '@/server/logger';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { backfillHistory, refreshPrices } from './market';
import { priceInMoney } from './tinvest-market';
import { syncSource } from './tinvest-sync';

const log = createLogger({
  level: 'error',
  getDb: createTestDb,
  console: new Writable({ write: (_c, _e, cb) => cb() }),
}).root;
const offline: Fetch = async () => new Response('', { status: 404 });
const now = new Date('2026-10-08T12:00:00Z');
let mock: TinvestMock;
beforeAll(async () => {
  mock = await startTinvestMock();
});
afterAll(() => mock.close());
afterEach(() => mock.clearFailures());

async function synced() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const sourceId = createTinvestSource(db, 'u1', MOCK_TOKEN);
  const client = new TinvestClient(MOCK_TOKEN, { baseUrl: mock.url, sleep: async () => {} });
  saveBrokerAccounts(db, 'u1', sourceId, await client.getAccounts({ includeClosed: true }), () => true);
  await syncSource(db, sourceId, { client, trigger: 'manual', now, log });
  const id = (isin: string) =>
    db.select({ id: instruments.id }).from(instruments).where(eq(instruments.isin, isin)).get()!.id;
  return { db, client, id };
}

describe('T-Invest prices', () => {
  it('turns a bond price from percent of the nominal into money', () => {
    expect(priceInMoney(new Decimal('62.4'), { kind: 'bond', meta: { nominal: '1000' } })?.toString()).toBe(
      '624',
    );
    expect(priceInMoney(new Decimal('62.4'), { kind: 'bond', meta: { nominal: '0' } })).toBeNull();
    expect(priceInMoney(new Decimal('62.4'), { kind: 'bond', meta: null })).toBeNull();
    expect(priceInMoney(new Decimal('300'), { kind: 'share', meta: null })?.toString()).toBe('300');
  });

  it('stores bond data when the sync creates the bond', async () => {
    const { db, id } = await synced();
    const ofz = db
      .select()
      .from(instruments)
      .where(eq(instruments.id, id('RU000A1038V6')))
      .get()!;
    expect(ofz.meta).toMatchObject({
      nominal: '1000',
      couponType: 'fixed',
      maturityDate: '2041-05-15',
      amortization: false,
    });
  });

  it('takes the latest prices from the broker, bonds in money', async () => {
    const { db, client, id } = await synced();
    await refreshPrices(db, log, offline, now, client);
    const last = (isin: string) =>
      db
        .select()
        .from(pricesLast)
        .where(eq(pricesLast.instrumentId, id(isin)))
        .get();
    expect(last('RU0009029540')).toMatchObject({ price: '300', currency: 'RUB', source: 'tinvest' });
    expect(last('RU000A1038V6')).toMatchObject({ price: '624', source: 'tinvest' });
    expect(last('RU000A101X76')).toMatchObject({ price: '7.1', source: 'tinvest' });
  });

  it('falls back to ISS when the broker fails, without failing the job', async () => {
    const { db, client } = await synced();
    mock.failNext({ status: 503 });
    let isoCalls = 0;
    const iss: Fetch = async () => {
      isoCalls++;
      return new Response('', { status: 404 });
    };
    await expect(refreshPrices(db, log, iss, now, client)).resolves.toBeUndefined();
    expect(isoCalls).toBeGreaterThan(0);
  });

  it('fills the price history from daily candles', async () => {
    const { db, client, id } = await synced();
    await backfillHistory(db, log, offline, now, client);
    const rows = db
      .select()
      .from(prices)
      .where(and(eq(prices.instrumentId, id('RU000A1038V6')), eq(prices.source, 'tinvest')))
      .all();
    // The first purchase of this bond was on 2023-08-01: weekdays since then.
    expect(rows.length).toBeGreaterThan(700);
    expect(rows.every((r) => r.close === '624')).toBe(true);
    expect(rows[0]!.date >= '2023-08-01').toBe(true);
  });
});
