import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fxRates, instruments, positionSnapshots, prices, pricesLast } from '@/db/schema';
import { insertOperation, seedAccount } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import type { Fetch } from '@/integrations/errors';
import { createLogger } from '@/server/logger';
import { backfillHistory, refreshPrices, snapshotThrough, updateSnapshots } from './market';

const raw = (p: string) => readFileSync(`tests/fixtures/${p}`);
const routes: Record<string, () => Response> = {
  '/history/engines/stock/markets/shares/boards/TQBR/securities/SBER.json': () =>
    new Response(raw('moex/history-SBER.json')),
  'iss.only=marketdata': () => new Response(raw('moex/marketdata-SBER.json')),
  XML_daily: () => new Response(raw('cbr/daily-2026-10-03.xml')),
  XML_dynamic: () => new Response(raw('cbr/dynamic-usd.xml')),
};
const fakeFetch: Fetch = async (url) => {
  const hit = Object.entries(routes).find(([p]) => url.includes(p));
  return hit ? hit[1]() : new Response('', { status: 404 });
};
const log = createLogger({
  level: 'error',
  getDb: createTestDb,
  console: new Writable({ write: (_c, _e, cb) => cb() }),
}).root;

// 15:00 in Moscow on 3 October: the last complete day is 2 October.
const now = new Date('2026-10-03T12:00:00Z');

function setup() {
  const db = createTestDb();
  seedAccount(db);
  db.insert(instruments)
    .values({
      id: 'sber',
      kind: 'share',
      assetClass: 'stocks',
      ticker: 'SBER',
      name: 'Сбербанк',
      currency: 'RUB',
      meta: { secid: 'SBER', engine: 'stock', market: 'shares', board: 'TQBR' },
    })
    .run();
  db.insert(instruments)
    .values({
      id: 'flat',
      kind: 'custom',
      assetClass: 'other',
      name: 'Квартира',
      currency: 'RUB',
      userId: 'u1',
    })
    .run();
  insertOperation(db, {
    type: 'buy',
    instrumentId: 'sber',
    quantity: '10',
    price: '270',
    amount: '-2700',
    executedAt: new Date('2026-09-29T08:00:00Z'),
  });
  insertOperation(db, {
    type: 'deposit',
    amount: '100',
    currency: 'USD',
    executedAt: new Date('2026-09-30T08:00:00Z'),
  });
  insertOperation(db, {
    type: 'buy',
    instrumentId: 'flat',
    quantity: '1',
    price: '5000000',
    amount: '-5000000',
    executedAt: new Date('2026-09-30T09:00:00Z'),
  });
  return db;
}

const snap = (db: ReturnType<typeof setup>, date: string, instrumentId: string) =>
  db
    .select()
    .from(positionSnapshots)
    .where(and(eq(positionSnapshots.date, date), eq(positionSnapshots.instrumentId, instrumentId)))
    .get();

describe('market jobs', () => {
  it('refresh stores the last price and today’s rates', async () => {
    const db = setup();
    await refreshPrices(db, log, fakeFetch, now);
    expect(db.select().from(pricesLast).where(eq(pricesLast.instrumentId, 'sber')).get()).toMatchObject({
      source: 'moex',
    });
    expect(db.select().from(fxRates).where(eq(fxRates.quote, 'USD')).get()).toMatchObject({
      date: '2026-10-03',
    });
  });

  it('backfills history and writes a value per day, rubles at the rate of that day', async () => {
    const db = setup();
    const added = await backfillHistory(db, log, fakeFetch, now);
    expect(added).toBeGreaterThan(0);
    expect(
      db.select().from(prices).where(eq(prices.instrumentId, 'sber')).all().length,
    ).toBeGreaterThanOrEqual(5);

    expect(updateSnapshots(db, now)).toBe(1);
    expect(snap(db, '2026-09-28', 'sber')).toBeUndefined();
    expect(snap(db, '2026-09-29', 'sber')).toMatchObject({
      quantity: '10',
      price: '274.65',
      value: '2746.5',
      approx: false,
    });
    expect(snap(db, '2026-10-02', 'sber')).toMatchObject({ value: '2754.5' });
    expect(snap(db, '2026-10-03', 'sber')).toBeUndefined();

    const usdCash = db.select().from(instruments).where(eq(instruments.ticker, 'USD')).get()!;
    // Last USD rate in the history fixture is 10 September.
    const rate = db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.quote, 'USD'), eq(fxRates.date, '2026-09-10')))
      .get()!.rate;
    expect(snap(db, '2026-09-30', usdCash.id)).toMatchObject({
      value: '100',
      currency: 'USD',
      valueRub: String(Number(rate) * 100),
    });

    // No market price: valued at the last trade, flagged.
    expect(snap(db, '2026-10-01', 'flat')).toMatchObject({ value: '5000000', approx: true });
  });

  it('only rebuilds accounts that are behind, unless forced', async () => {
    const db = setup();
    await backfillHistory(db, log, fakeFetch, now);
    updateSnapshots(db, now);
    expect(updateSnapshots(db, now)).toBe(0);
    expect(updateSnapshots(db, now, true)).toBe(1);
  });
});

describe('snapshotThrough', () => {
  it('counts today only after the snapshot time in the display zone', () => {
    expect(snapshotThrough(new Date('2026-10-03T20:49:00Z'), 'Europe/Moscow', '23:50')).toBe('2026-10-02');
    expect(snapshotThrough(new Date('2026-10-03T20:51:00Z'), 'Europe/Moscow', '23:50')).toBe('2026-10-03');
  });
});
