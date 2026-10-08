import { Writable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recalcAccount } from '@/db/mutations/positions';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { createTinvestSource } from '@/db/mutations/sources';
import { finAccounts, instruments, jobs, operations, positions, sources, syncRuns, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { OperationItem, TinvestClient } from '@/integrations/tinvest/client';
import { mapOperations } from '@/integrations/tinvest/map';
import { createLogger } from '@/server/logger';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../tests/mock/tinvest';
import { enqueueDueSyncs, syncSource, yearWindows } from './tinvest-sync';

const log = createLogger({
  level: 'error',
  getDb: createTestDb,
  console: new Writable({ write: (_c, _e, cb) => cb() }),
}).root;
let mock: TinvestMock;
beforeAll(async () => {
  mock = await startTinvestMock();
});
afterAll(() => mock.close());

const now = new Date('2026-10-08T12:00:00Z');

async function setup(token = MOCK_TOKEN) {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const sourceId = createTinvestSource(db, 'u1', token);
  const client = new TinvestClient(token, { baseUrl: mock.url, sleep: async () => {} });
  const accounts = await new TinvestClient(MOCK_TOKEN, { baseUrl: mock.url }).getAccounts({
    includeClosed: true,
  });
  const ids = saveBrokerAccounts(db, 'u1', sourceId, accounts, () => true);
  return { db, sourceId, client, ids };
}
const sync = (s: Awaited<ReturnType<typeof setup>>) =>
  syncSource(s.db, s.sourceId, { client: s.client, trigger: 'manual', now, log });
const executed = (account: string) =>
  mock.state.operations.filter(
    (o) => o.brokerAccountId === account && o.state === 'OPERATION_STATE_EXECUTED',
  );

describe('T-Invest sync', () => {
  it('splits the history into calendar years', () => {
    const w = yearWindows(new Date('2024-06-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
    expect(w.map((x) => x.year)).toEqual([2024, 2025, 2026]);
    expect(w[0]!.to.toISOString()).toBe('2024-12-31T23:59:59.999Z');
    expect(w[1]!.from.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('creates journal accounts, skipping the DFA account', async () => {
    const s = await setup();
    expect([...s.ids.keys()].sort()).toEqual(['2000000001', '2000000002', '2000000003']);
    const kinds = s.db
      .select({ kind: finAccounts.kind, closedAt: finAccounts.closedAt })
      .from(finAccounts)
      .all();
    expect(kinds).toContainEqual({ kind: 'iis', closedAt: '2023-07-17' });
  });

  it('imports every account, and a second run on the same data adds nothing', async () => {
    const s = await setup();
    const first = await sync(s);
    expect(first.accounts).toBe(3);
    const count = s.db.select().from(operations).all().length;
    expect(first.newOperations).toBe(count);
    // Fees and taxes fold into their trades and payouts; a dividend to a card adds a withdrawal.
    const items = ['2000000001', '2000000002', '2000000003']
      .flatMap(executed)
      .map((o) => OperationItem.parse(o));
    expect(count).toBe(mapOperations(items).operations.length);

    const second = await sync(s);
    expect(second.newOperations).toBe(0);
    expect(s.db.select().from(operations).all()).toHaveLength(count);
    const runs = s.db.select().from(syncRuns).all();
    expect(runs.map((r) => [r.status, r.newOperations, r.progress?.stage])).toEqual([
      ['ok', count, 'done'],
      ['ok', 0, 'done'],
    ]);
    const src = s.db.select().from(sources).where(eq(sources.id, s.sourceId)).get()!;
    expect(src.status).toBe('ok');
    expect(src.lastSyncAt).not.toBeNull();
  });

  it('reads a closed account once and the others from the last operation minus three days', async () => {
    const s = await setup();
    await sync(s);
    mock.calls.length = 0;
    await sync(s);
    const opsCalls = mock.calls.filter((c) => c.method === 'OperationsService/GetOperationsByCursor');
    expect(opsCalls.map((c) => c.body.accountId)).not.toContain('2000000003');
    const a1 = opsCalls.find((c) => c.body.accountId === '2000000001')!;
    // The last operation of the broker account is on 2026-06-01; the window starts three days earlier.
    expect(a1.body.from).toBe('2026-05-29T09:00:00.000Z');
  });

  it('re-links an operation whose broker id changed instead of adding it again', async () => {
    const s = await setup();
    await sync(s);
    // Within the overlap window of the next run.
    const latest = mock.state.operations.find(
      (o) => o.brokerAccountId === '2000000001' && o.type === 'OPERATION_TYPE_SOMETHING_NEW',
    )!;
    const oldId = latest.id;
    latest.id = '99999999999';
    try {
      const again = await sync(s);
      expect(again).toMatchObject({ newOperations: 0, relinked: 1 });
      const row = s.db
        .select()
        .from(operations)
        .where(and(eq(operations.sourceId, s.sourceId), eq(operations.externalId, '2000000001:99999999999')))
        .get();
      expect(row?.type).toBe('other');
      expect(
        s.db
          .select()
          .from(operations)
          .where(eq(operations.externalId, `2000000001:${oldId}`))
          .get(),
      ).toBeUndefined();
    } finally {
      latest.id = oldId;
    }
  });

  it('fills the redemption quantity from the holding and merges trading modes by ISIN', async () => {
    const s = await setup();
    await sync(s);
    const a1 = s.ids.get('2000000001')!;
    const redemption = s.db
      .select()
      .from(operations)
      .where(and(eq(operations.accountId, a1), eq(operations.type, 'redemption')))
      .get()!;
    expect(redemption.quantity).toBe('20');
    expect(redemption.price).toBe('1000');

    const tmos = s.db.select().from(instruments).where(eq(instruments.isin, 'RU000A101X76')).all();
    expect(tmos).toHaveLength(1);
    const usd = s.db.select().from(operations).where(eq(operations.type, 'fx_buy')).get()!;
    const usdInstrument = s.db.select().from(instruments).where(eq(instruments.id, usd.instrumentId!)).get()!;
    expect([usdInstrument.kind, usdInstrument.ticker]).toEqual(['currency', 'USD']);
  });

  it('reproduces the broker portfolio after positions are recalculated', async () => {
    const s = await setup();
    await sync(s);
    for (const [external, accountId] of s.ids) {
      if (external === '2000000003') continue;
      recalcAccount(s.db, accountId);
      const held = s.db
        .select({ ticker: instruments.ticker, isin: instruments.isin, quantity: positions.quantity })
        .from(positions)
        .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
        .where(eq(positions.accountId, accountId))
        .all();
      const broker = (mock.state.portfolio[external]?.positions ?? []) as {
        ticker: string;
        quantity: { units: string; nano: number };
      }[];
      for (const p of broker) {
        const ticker =
          p.ticker === 'RUB000UTSTOM'
            ? 'RUB'
            : p.ticker === 'USD000UTSTOM'
              ? 'USD'
              : p.ticker.replace('@', '');
        const mine = held.find((h) => h.ticker === ticker);
        const expected = (Number(p.quantity.units) + p.quantity.nano / 1e9).toFixed(2);
        expect(Number(mine?.quantity ?? 0).toFixed(2), `${external} ${p.ticker}`).toBe(expected);
      }
    }
  });

  it('records a readable error and keeps the token out of it', async () => {
    const s = await setup('t.revoked-token');
    const err = await sync(s).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'UNAUTHENTICATED', retryable: false });
    const run = s.db.select().from(syncRuns).get()!;
    expect(run).toMatchObject({ status: 'error', error: 'Токен не найден или отозван. Выпустите новый' });
    const src = s.db.select().from(sources).get()!;
    expect(src.lastError).toBe('Токен не найден или отозван. Выпустите новый');
    expect(JSON.stringify([run, src.lastError])).not.toContain('revoked-token');
  });

  it('waits out a rate limit instead of failing', async () => {
    const s = await setup();
    mock.failNext({ status: 429, code: '80002', resetSeconds: 2 });
    await expect(sync(s)).resolves.toMatchObject({ accounts: 3 });
  });

  it('queues sources whose interval has passed', async () => {
    const s = await setup();
    expect(enqueueDueSyncs(s.db, now)).toBe(1);
    s.db
      .update(sources)
      .set({ lastSyncAt: new Date(now.getTime() - 5 * 60_000) })
      .run();
    s.db.delete(jobs).run();
    expect(enqueueDueSyncs(s.db, now)).toBe(0);
    s.db
      .update(sources)
      .set({ lastSyncAt: new Date(now.getTime() - 16 * 60_000) })
      .run();
    expect(enqueueDueSyncs(s.db, now)).toBe(1);
    s.db.update(sources).set({ status: 'disabled' }).run();
    s.db.delete(jobs).run();
    expect(enqueueDueSyncs(s.db, now)).toBe(0);
  });
});
