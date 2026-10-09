import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { savePortfolio } from '@/db/mutations/portfolios';
import { recalcAccount } from '@/db/mutations/positions';
import { createTinvestSource } from '@/db/mutations/sources';
import { finAccounts, instruments, pricesLast, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import { TinvestClient } from '@/integrations/tinvest/client';
import { syncSource } from '@/jobs/tinvest-sync';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { assetView } from './asset-data';
import { ensureBenchmarks } from './benchmarks';
import { createLogger } from './logger';

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

describe('asset page data (FR-AST-1…3)', () => {
  it('shows the position, average and result with payouts, markers, portfolios and the limit', async () => {
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
    for (const a of db.select({ id: finAccounts.id }).from(finAccounts).all()) recalcAccount(db, a.id);
    const sber = db.select().from(instruments).where(eq(instruments.ticker, 'SBER')).get()!;
    db.insert(pricesLast)
      .values({ instrumentId: sber.id, price: '300', currency: 'RUB', at: now, source: 'tinvest' })
      .run();
    const a1 = ids.get('2000000001')!;
    const pid = savePortfolio(db, 'u1', {
      name: 'Брокерский',
      rules: [{ accountId: a1, mode: 'all', tagId: null }],
      targetsEnabled: false,
      targets: {},
      deviationThreshold: new Decimal(5),
    });

    const v = assetView(db, 'u1', sber.id, pid)!;
    expect(v.portfolio?.name).toBe('Брокерский');
    // 60 transferred in at 260, 40 bought at 250 (+7.5 fee), 20 sold.
    expect(v.quantity.toString()).toBe('80');
    expect(v.valueRub.toString()).toBe('24000');
    expect(v.price?.toString()).toBe('300');
    // FIFO: the sale takes 20 of the first lot; 40 × 260 and 40 × 250.1875 (fee included) remain.
    expect(v.avgPrice?.toFixed(2)).toBe('255.09');
    // The dividend of 3 315 less 431 tax.
    expect(v.payoutsRub.toString()).toBe('2884');
    expect(v.totalRub.toString()).toBe(v.courseRub.plus(2884).toString());
    expect(v.markers.map((m) => m.kind)).toEqual(['buy', 'buy', 'payout', 'sell']);
    expect(v.operations[0]!.type).toBe('sell');
    expect(v.portfolios.map((p) => [p.name, p.quantity.toString()])).toEqual([['Брокерский', '80']]);
    expect(v.limit).toMatchObject({ pct: 8 });

    // The index is not an asset page; nor is someone else's custom asset.
    const index = ensureBenchmarks(db).get('MCFTR')!;
    expect(assetView(db, 'u1', index)).toBeNull();
    expect(assetView(db, 'u1', 'nope')).toBeNull();
  });
});
