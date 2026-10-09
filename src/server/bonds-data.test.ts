import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { recalcAccount } from '@/db/mutations/positions';
import { createTinvestSource } from '@/db/mutations/sources';
import { finAccounts, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { TinvestClient } from '@/integrations/tinvest/client';
import { refreshPrices } from '@/jobs/market';
import { refreshPayouts } from '@/jobs/payouts';
import { syncSource } from '@/jobs/tinvest-sync';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { bondsData } from './bonds-data';
import { createLogger } from './logger';
import { getSettings } from './settings';

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

describe('bonds of an area', () => {
  it('yield, duration, coupons and the redemption of the synced OFZ', async () => {
    const db = createTestDb();
    db.insert(user)
      .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
      .run();
    const sourceId = createTinvestSource(db, 'u1', MOCK_TOKEN);
    const client = new TinvestClient(MOCK_TOKEN, { baseUrl: mock.url, sleep: async () => {} });
    saveBrokerAccounts(db, 'u1', sourceId, await client.getAccounts({ includeClosed: true }), () => true);
    await syncSource(db, sourceId, { client, trigger: 'manual', now, log });
    for (const a of db.select({ id: finAccounts.id }).from(finAccounts).all()) recalcAccount(db, a.id);
    await refreshPrices(db, log, async () => new Response('', { status: 404 }), now, client);
    await refreshPayouts(db, client, log, now);

    const b = bondsData(db, 'u1', null, getSettings(db, 'u1'), now);
    expect(b.rows).toHaveLength(1);
    const ofz = b.rows[0]!;
    expect(ofz.name).toBe('ОФЗ 26238');
    expect(ofz.quantity.toFixed()).toBe('10');
    expect(ofz.pricePct!.toFixed(1)).toBe('62.4');
    expect(ofz.couponPct!.toFixed(2)).toBe('7.13');
    expect(ofz.noSchedule).toBe(false);
    // 35,65 twice a year at 62,4 % plus 16,45 accrued: about 13 % to 2041, duration about 8 years.
    expect(ofz.ytm!.times(100).toNumber()).toBeGreaterThan(12);
    expect(ofz.ytm!.times(100).toNumber()).toBeLessThan(14);
    expect(ofz.duration!.toNumber()).toBeGreaterThan(7);
    expect(ofz.duration!.toNumber()).toBeLessThan(9);
    expect(b.ytm!.eq(ofz.ytm!)).toBe(true);
    expect(b.couponsYear.toFixed()).toBe('713');
    expect(b.redemptions).toEqual([{ year: '2041', amount: expect.anything() }]);
    expect(b.redemptions[0]!.amount.toFixed()).toBe('10000');
    expect(b.soon).toEqual([]);
    expect(b.shock.lt(0)).toBe(true);
    expect(b.floatingShare.toFixed()).toBe('0');
  });
});
