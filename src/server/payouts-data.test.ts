import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { recalcAccount } from '@/db/mutations/positions';
import { createTinvestSource } from '@/db/mutations/sources';
import { finAccounts, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { TinvestClient } from '@/integrations/tinvest/client';
import { refreshPayouts } from '@/jobs/payouts';
import { syncSource } from '@/jobs/tinvest-sync';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { createLogger } from './logger';
import { payoutsView } from './payouts-data';

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

describe('payouts page (FR-PAY-1…4)', () => {
  it('sums received payouts of a year, the expected ones to December, the forecast and the months', async () => {
    const db = createTestDb();
    db.insert(user)
      .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
      .run();
    const sourceId = createTinvestSource(db, 'u1', MOCK_TOKEN);
    const client = new TinvestClient(MOCK_TOKEN, { baseUrl: mock.url, sleep: async () => {} });
    saveBrokerAccounts(db, 'u1', sourceId, await client.getAccounts({ includeClosed: true }), () => true);
    await syncSource(db, sourceId, { client, trigger: 'manual', now, log });
    for (const a of db.select({ id: finAccounts.id }).from(finAccounts).all()) recalcAccount(db, a.id);
    await refreshPayouts(db, client, log, now);

    const past = payoutsView(db, 'u1', 2024, undefined, now);
    // Coupon 356.5 − 46, dividend 3 315 − 431, a dividend of 1 200 paid to a card.
    expect(past.received.toString()).toBe('4394.5');
    expect(past.upcoming).toEqual([]);
    expect(past.years).toEqual([2026, 2024, 2020]);
    expect(past.months[6]!.received.toString()).toBe('2884');

    const current = payoutsView(db, 'u1', undefined, undefined, now);
    expect(current.year).toBe(2026);
    // SBER declared 36.5 a share, paid 28 October, on the 80 held now.
    expect(
      current.upcoming.map((u) => [u.date, u.name, u.quantity?.toString(), u.amountRub.toString()]),
    ).toEqual([['2026-10-28', 'Сбер Банк', '80', '2920']]);
    expect(current.expected.toString()).toBe('2920');
    expect(current.nearest).toBe('2026-10-28');
    expect(current.forecast.toString()).toBe(current.received.plus(2920).toString());
    expect(current.months[9]!.expected.toString()).toBe('2920');
  });
});
