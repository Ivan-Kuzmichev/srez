import { Writable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { createTinvestSource } from '@/db/mutations/sources';
import { discrepancies, instruments, operations, positions, reconcileExclusions, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import { TinvestClient } from '@/integrations/tinvest/client';
import { reconcileAccount } from '@/jobs/tinvest-reconcile';
import { syncSource } from '@/jobs/tinvest-sync';
import { createLogger } from '@/server/logger';
import { reconcileView } from '@/server/reconcile';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../../tests/mock/tinvest';
import { applyFix, ReconcileError, snoozeDiscrepancy, undoFix } from './reconcile';

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

async function setup() {
  const db = createTestDb();
  for (const id of ['u1', 'u2'])
    db.insert(user)
      .values({ id, name: id, email: `${id}@local.invalid`, createdAt: now, updatedAt: now })
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
  const a1 = ids.get('2000000001')!;
  const idOf = (isin: string) =>
    db.select({ id: instruments.id }).from(instruments).where(eq(instruments.isin, isin)).get()!.id;
  const discrepancyOf = (isin: string) =>
    db
      .select()
      .from(discrepancies)
      .where(eq(discrepancies.instrumentId, idOf(isin)))
      .all();
  const recheck = () => reconcileAccount(db, client, { id: a1, externalId: '2000000001' }, now, '2026-10-08');
  return { db, sourceId, a1, idOf, discrepancyOf, recheck };
}

const GAZP = 'RU0007661625';
const LKOH = 'RU0009024277';

describe('fixing discrepancies', () => {
  it('a transfer closes the discrepancy, undo brings it back', async () => {
    const { db, sourceId, discrepancyOf, recheck } = await setup();
    const [d] = discrepancyOf(GAZP);
    const opId = applyFix(db, 'u1', d!.id, { fix: 'transfer', executedAt: now, price: new Decimal(125) })!;
    const op = db.select().from(operations).where(eq(operations.id, opId)).get()!;
    expect(op).toMatchObject({
      type: 'transfer_in',
      quantity: '50',
      price: '125',
      origin: 'reconcile',
      sourceId,
    });
    expect(discrepancyOf(GAZP)[0]).toMatchObject({ status: 'resolved', resolutionOperationId: opId });

    // The journal now agrees: the next check opens nothing.
    expect((await recheck()).open).toBe(1);
    expect(discrepancyOf(GAZP)).toHaveLength(1);
    expect(reconcileView(db, 'u1', sourceId)!.fixed.map((f) => f.name)).toEqual(['Газпром']);

    undoFix(db, 'u1', d!.id);
    expect(db.select().from(operations).where(eq(operations.id, opId)).get()).toBeUndefined();
    expect(discrepancyOf(GAZP)[0]).toMatchObject({ status: 'open', resolutionOperationId: null });
    await recheck();
    expect(discrepancyOf(GAZP)).toHaveLength(1);
    expect(discrepancyOf(GAZP)[0]!.status).toBe('open');
  });

  it('a split brings the holding to the broker figure', async () => {
    const { db, a1, idOf, discrepancyOf, recheck } = await setup();
    applyFix(db, 'u1', discrepancyOf(LKOH)[0]!.id, { fix: 'split', executedAt: now, price: null });
    await recheck();
    const held = db
      .select({ q: positions.quantity })
      .from(positions)
      .where(and(eq(positions.accountId, a1), eq(positions.instrumentId, idOf(LKOH))))
      .get();
    expect(held?.q).toBe('10');
    expect(discrepancyOf(LKOH).map((d) => d.status)).toEqual(['resolved']);
  });

  it('several splits, each on its date, reach the broker together and undo together', async () => {
    const { db, a1, idOf, discrepancyOf, recheck } = await setup();
    const id = discrepancyOf(LKOH)[0]!.id;
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
    const step = (h: number, from: string, to: string) => ({
      at: at(h),
      from: new Decimal(from),
      to: new Decimal(to),
    });
    // 1 → 2 → 10 is right; 1 → 2 → 6 falls short and says what it would give.
    expect(() =>
      applyFix(db, 'u1', id, {
        fix: 'split',
        executedAt: now,
        price: null,
        splits: [step(1, '1', '2'), step(2, '1', '3')],
      }),
    ).toThrow(expect.objectContaining({ code: 'SPLIT_TOTAL', detail: '6' }));
    applyFix(db, 'u1', id, {
      fix: 'split',
      executedAt: now,
      price: null,
      splits: [step(2, '1', '5'), step(1, '1', '2')],
    });
    const splits = () =>
      db
        .select({ q: operations.quantity })
        .from(operations)
        .where(and(eq(operations.instrumentId, idOf(LKOH)), eq(operations.type, 'split')))
        .orderBy(operations.executedAt)
        .all()
        .map((o) => o.q);
    expect(splits()).toEqual(['1', '8']);
    await recheck();
    const held = db
      .select({ q: positions.quantity })
      .from(positions)
      .where(and(eq(positions.accountId, a1), eq(positions.instrumentId, idOf(LKOH))))
      .get();
    expect(held?.q).toBe('10');
    expect(discrepancyOf(LKOH).map((d) => d.status)).toEqual(['resolved']);
    undoFix(db, 'u1', id);
    expect(splits()).toEqual([]);
    expect(discrepancyOf(LKOH).map((d) => d.status)).toEqual(['open']);
  });

  it('refuses a split before the security was held', async () => {
    const { db, discrepancyOf } = await setup();
    const early = { at: new Date('2000-01-01T12:00:00Z'), from: new Decimal(1), to: new Decimal(10) };
    expect(() =>
      applyFix(db, 'u1', discrepancyOf(LKOH)[0]!.id, {
        fix: 'split',
        executedAt: now,
        price: null,
        splits: [early],
      }),
    ).toThrow(expect.objectContaining({ code: 'SPLIT_DATE', detail: '0' }));
  });

  it('needs a price for a missing trade', async () => {
    const { db, discrepancyOf } = await setup();
    expect(() =>
      applyFix(db, 'u1', discrepancyOf(GAZP)[0]!.id, { fix: 'trade', executedAt: now, price: null }),
    ).toThrow(ReconcileError);
    const opId = applyFix(db, 'u1', discrepancyOf(GAZP)[0]!.id, {
      fix: 'trade',
      executedAt: now,
      price: new Decimal('130.5'),
    })!;
    expect(db.select().from(operations).where(eq(operations.id, opId)).get()).toMatchObject({
      type: 'buy',
      amount: '-6525',
    });
  });

  it('excludes a security, snoozes and wakes a discrepancy, and refuses someone else', async () => {
    const { db, a1, idOf, discrepancyOf } = await setup();
    applyFix(db, 'u1', discrepancyOf(GAZP)[0]!.id, { fix: 'exclude', executedAt: now, price: null });
    expect(discrepancyOf(GAZP)[0]!.status).toBe('ignored');
    expect(db.select().from(reconcileExclusions).all()).toEqual([
      { accountId: a1, instrumentId: idOf(GAZP) },
    ]);

    const lkoh = discrepancyOf(LKOH)[0]!.id;
    snoozeDiscrepancy(db, 'u1', lkoh, true);
    expect(discrepancyOf(LKOH)[0]!.status).toBe('snoozed');
    snoozeDiscrepancy(db, 'u1', lkoh, false);
    expect(discrepancyOf(LKOH)[0]!.status).toBe('open');

    expect(() => snoozeDiscrepancy(db, 'u2', lkoh, true)).toThrow('NOT_FOUND');
    expect(() => applyFix(db, 'u2', lkoh, { fix: 'split', executedAt: now, price: null })).toThrow(
      'NOT_FOUND',
    );
  });

  it('shows the selected discrepancy with the journal and the fitting fixes', async () => {
    const { db, sourceId, discrepancyOf } = await setup();
    const view = reconcileView(db, 'u1', sourceId, discrepancyOf(LKOH)[0]!.id)!;
    expect(view.items.map((i) => [i.name, i.diff.toString(), i.guess]).sort()).toEqual([
      ['Газпром', '50', 'transfer'],
      ['Лукойл', '9', 'split'],
    ]);
    expect(view.selected).toMatchObject({ name: 'Лукойл', fixes: ['split', 'transfer', 'trade', 'exclude'] });
    expect(view.selected!.operations.map((o) => [o.type, o.quantity.toString()])).toEqual([
      ['buy', '1'],
      ['dividend', '0'],
    ]);
    expect(view.summary).toEqual({ matched: 3, open: 2 });
    expect(reconcileView(db, 'u2', sourceId)).toBeNull();
  });
});
