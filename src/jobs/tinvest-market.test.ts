import { Writable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { createTinvestSource } from '@/db/mutations/sources';
import { instruments, prices, pricesLast, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import type { Fetch } from '@/integrations/errors';
import { TinvestClient, type Bond } from '@/integrations/tinvest/client';
import { createLogger } from '@/server/logger';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { backfillHistory, refreshPrices } from './market';
import { ensureBondMeta, priceCurrency, priceInMoney } from './tinvest-market';
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

  it('a ruble-traded bond on a dollar nominal is priced in dollars; its old ruble prices go once', async () => {
    const { db, id } = await synced();
    const bondId = id('RU000A1038V6');
    const read = () => db.select().from(instruments).where(eq(instruments.id, bondId)).get()!;
    // As stored before the nominal currency was kept: 94,45 % × 100 taken as rubles.
    const { nominalCurrency: _, ...old } = read().meta as Record<string, unknown>;
    db.update(instruments)
      .set({ meta: { ...old, nominal: '100' } })
      .where(eq(instruments.id, bondId))
      .run();
    db.insert(prices)
      .values({
        instrumentId: bondId,
        date: '2026-10-01',
        close: '94.45',
        currency: 'RUB',
        source: 'tinvest',
      })
      .run();
    const client = {
      getBond: async () =>
        ({
          nominal: { currency: 'usd', units: '100', nano: 0 },
          aciValue: { currency: 'usd', units: '0', nano: 460_000_000 },
          floatingCouponFlag: false,
          maturityDate: new Date('2029-05-09T00:00:00Z'),
          amortizationFlag: false,
          couponQuantityPerYear: 12,
        }) as Bond,
    } as unknown as TinvestClient;
    const inst = read();
    const meta = await ensureBondMeta(db, client, inst, '2026-10-08');
    expect(meta).toMatchObject({ nominal: '100', nominalCurrency: 'USD' });
    expect(priceCurrency({ ...inst, meta })).toBe('USD');
    expect(priceInMoney(new Decimal('94.4451'), { kind: 'bond', meta })?.toString()).toBe('94.4451');
    expect(db.select().from(prices).where(eq(prices.instrumentId, bondId)).all()).toEqual([]);
    // Known now: the next read keeps the prices.
    db.insert(prices)
      .values({ instrumentId: bondId, date: '2026-10-02', close: '94.5', currency: 'USD', source: 'tinvest' })
      .run();
    await ensureBondMeta(db, client, { ...inst, meta }, '2026-10-09');
    expect(db.select().from(prices).where(eq(prices.instrumentId, bondId)).all()).toHaveLength(1);
    // A ruble bond stays in rubles.
    expect(priceCurrency({ kind: 'bond', currency: 'RUB', meta: { nominalCurrency: 'RUB' } })).toBe('RUB');
    expect(priceCurrency({ kind: 'share', currency: 'USD', meta: null })).toBe('USD');
  });

  it('sectors come from the broker once per instrument, a choice of the owner stays', async () => {
    const { db, client, id } = await synced();
    await refreshPrices(db, log, offline, now, client);
    const meta = (isin: string) =>
      db.select({ meta: instruments.meta }).from(instruments).where(eq(instruments.isin, isin)).get()!.meta;
    expect(meta('RU0009029540')).toMatchObject({ sector: 'financial' });
    expect(meta('RU0009024277')).toMatchObject({ sector: 'energy' });
    expect(meta('RU000A101X76')).toMatchObject({ sector: 'other' });
    expect(meta('RU000A1038V6')).toMatchObject({ sector: 'government' });
    // The owner's sector for SBER is not asked again or overwritten.
    db.update(instruments)
      .set({ meta: { ...meta('RU0009029540'), sector: 'it', sectorManual: true } })
      .where(eq(instruments.id, id('RU0009029540')))
      .run();
    await refreshPrices(db, log, offline, now, client);
    expect(meta('RU0009029540')).toMatchObject({ sector: 'it', sectorManual: true });
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

  it('reads bond data again once a day: the accrued interest and the nominal', async () => {
    const { db, client, id } = await synced();
    const meta = () =>
      db
        .select({ meta: instruments.meta })
        .from(instruments)
        .where(eq(instruments.id, id('RU000A1038V6')))
        .get()!.meta;
    expect(meta()).toMatchObject({ aci: '16.45', metaDate: null });
    await refreshPrices(db, log, offline, now, client);
    expect(meta()).toMatchObject({ aci: '16.45', metaDate: '2026-10-08' });
    // A stale nominal comes back from the broker on the next day's first refresh.
    db.update(instruments)
      .set({ meta: { ...meta(), nominal: '900' } })
      .where(eq(instruments.id, id('RU000A1038V6')))
      .run();
    await refreshPrices(db, log, offline, now, client);
    expect(meta()).toMatchObject({ nominal: '900' });
    await refreshPrices(db, log, offline, new Date('2026-10-09T12:00:00Z'), client);
    expect(meta()).toMatchObject({ nominal: '1000', metaDate: '2026-10-09' });
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
