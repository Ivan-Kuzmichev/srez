import { and, asc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Db, Executor } from '@/db/client';
import { finAccounts, operations, sources, syncRuns, SYNC_TRIGGERS, type SyncProgress } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { heldQuantity } from '@/domain/holdings';
import { TinvestClient, TinvestError, type OperationItem } from '@/integrations/tinvest/client';
import { mapOperations, openingBalance, type MappedOperation } from '@/integrations/tinvest/map';
import { ru } from '@/lib/i18n/ru';
import { localDate } from '@/lib/time';
import { getSettings } from '@/server/settings';
import { enqueuePayouts } from './payouts';
import { enqueueRecalc } from './positions';
import { enqueue, retryDelayMs } from './queue';
import { defineJob } from './runner';
import { tinvestToken } from './source-token';
import { tinvestClient } from './tinvest-client';
import { reconcileAccount } from './tinvest-reconcile';
import { instrumentKey, resolveInstruments } from './tinvest-instruments';

export const SYNC_JOB = 'sync.tinvest';
export const SYNC_DUE_JOB = 'sync.due';
/** Later syncs re-read this much before the last known operation; duplicates fall on the unique index. */
const OVERLAP_MS = 3 * 86_400_000;
const EARLIEST = new Date('2015-01-01T00:00:00Z');

export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

export function enqueueSync(db: Executor, sourceId: string, trigger: SyncTrigger): number | null {
  return enqueue(db, SYNC_JOB, { sourceId, trigger }, { singletonKey: `${SYNC_JOB}:${sourceId}` });
}

/** The interface text for a failed run (docs/05-integrations.md, «Ошибки для интерфейса»). */
export function syncErrorText(err: unknown, attempt: number): string {
  if (!(err instanceof TinvestError)) return ru.tinvest.errors.INTERNAL;
  if (err.code === 'UNAVAILABLE')
    return ru.tinvest.errors.UNAVAILABLE(Math.max(1, Math.round(retryDelayMs(attempt) / 60_000)));
  return ru.tinvest.errors[err.code];
}

/** Calendar-year windows from `from` to `to`, so the wizard can show «2021, 2022, …». */
export function yearWindows(from: Date, to: Date): { from: Date; to: Date; year: number }[] {
  const out: { from: Date; to: Date; year: number }[] = [];
  let start = from;
  while (start < to) {
    const year = start.getUTCFullYear();
    const next = new Date(Date.UTC(year + 1, 0, 1));
    const end = next < to ? next : to;
    out.push({ from: start, to: new Date(end.getTime() - 1), year });
    start = end;
  }
  return out;
}

interface AccountRow {
  id: string;
  userId: string;
  name: string;
  externalId: string;
  openedAt: string | null;
  meta: Record<string, unknown> | null;
}

/**
 * Writes one account's mapped operations. Idempotent: a known broker id is skipped; a known
 * fingerprint under an id the broker no longer sends is re-linked to the new id.
 */
export function importOperations(
  db: Executor,
  account: AccountRow,
  sourceId: string,
  mapped: MappedOperation[],
  instrumentIds: Map<string, string>,
): { inserted: number; relinked: number } {
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: operations.id, externalId: operations.externalId, fingerprint: operations.fingerprint })
      .from(operations)
      .where(
        and(
          eq(operations.sourceId, sourceId),
          eq(operations.accountId, account.id),
          isNotNull(operations.externalId),
        ),
      )
      .all();
    const byExternal = new Set(existing.map((r) => r.externalId));
    const batchIds = new Set(mapped.map((m) => m.externalId));
    const byFingerprint = new Map(
      existing.filter((r) => r.fingerprint && !batchIds.has(r.externalId!)).map((r) => [r.fingerprint!, r]),
    );
    let inserted = 0;
    let relinked = 0;

    for (const m of mapped) {
      if (byExternal.has(m.externalId)) continue;
      const moved = byFingerprint.get(m.fingerprint);
      if (moved) {
        tx.update(operations).set({ externalId: m.externalId }).where(eq(operations.id, moved.id)).run();
        byFingerprint.delete(m.fingerprint);
        byExternal.add(m.externalId);
        relinked++;
        continue;
      }
      const instrumentId = m.instrument ? (instrumentIds.get(instrumentKey(m.instrument)) ?? null) : null;
      let { quantity, price } = m;
      if (m.quantityFromHolding && instrumentId) {
        // Full redemption: the broker sends no quantity; it is what the account held.
        const before = tx
          .select({ type: operations.type, quantity: operations.quantity })
          .from(operations)
          .where(
            and(
              eq(operations.accountId, account.id),
              eq(operations.instrumentId, instrumentId),
              lt(operations.executedAt, m.executedAt),
            ),
          )
          .orderBy(asc(operations.executedAt))
          .all();
        quantity = heldQuantity(before.map((r) => ({ type: r.type, quantity: new Decimal(r.quantity) })));
        price = quantity.gt(0) ? m.amount.plus(m.tax).div(quantity) : new Decimal(0);
      }
      tx.insert(operations)
        .values({
          userId: account.userId,
          accountId: account.id,
          instrumentId,
          type: m.type,
          executedAt: m.executedAt,
          quantity: quantity.toString(),
          price: price.toString(),
          currency: m.currency,
          amount: m.amount.toString(),
          fee: m.fee.toString(),
          tax: m.tax.toString(),
          accruedInterest: m.accruedInterest.toString(),
          note: m.note,
          origin: 'tinvest',
          sourceId,
          externalId: m.externalId,
          fingerprint: m.fingerprint,
          raw: m.raw,
        })
        .run();
      byExternal.add(m.externalId);
      inserted++;
    }
    return { inserted, relinked };
  });
}

export interface SyncResult {
  newOperations: number;
  relinked: number;
  accounts: number;
}

/** One sync of a T-Invest source: every enabled account, then positions are recalculated. */
export async function syncSource(
  db: Db,
  sourceId: string,
  opts: { client: TinvestClient; trigger: SyncTrigger; attempt?: number; now?: Date; log?: Logger },
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const run = db
    .insert(syncRuns)
    .values({
      sourceId,
      trigger: opts.trigger,
      startedAt: now,
      attempt: opts.attempt ?? 1,
      progress: { stage: 'accounts', percent: 0 },
    })
    .returning({ id: syncRuns.id })
    .get();
  const progress = (p: SyncProgress) =>
    db.update(syncRuns).set({ progress: p }).where(eq(syncRuns.id, run.id)).run();

  try {
    const accounts = db
      .select({
        id: finAccounts.id,
        userId: finAccounts.userId,
        name: finAccounts.name,
        externalId: finAccounts.externalId,
        openedAt: finAccounts.openedAt,
        meta: finAccounts.meta,
      })
      .from(finAccounts)
      .where(
        and(
          eq(finAccounts.sourceId, sourceId),
          eq(finAccounts.syncEnabled, true),
          isNotNull(finAccounts.externalId),
        ),
      )
      .all()
      .filter((a): a is AccountRow => a.externalId !== null)
      // A closed account is read once: its history does not change.
      .filter((a) => !(a.meta?.closed && a.meta?.syncedAt));

    let newOperations = 0;
    let relinked = 0;
    for (const [index, account] of accounts.entries()) {
      const last = db
        .select({ at: operations.executedAt })
        .from(operations)
        .where(
          and(
            eq(operations.sourceId, sourceId),
            eq(operations.accountId, account.id),
            isNotNull(operations.externalId),
          ),
        )
        .orderBy(operations.executedAt)
        .all()
        .at(-1)?.at;
      const opened = account.openedAt ? new Date(`${account.openedAt}T00:00:00Z`) : EARLIEST;
      // The wizard's «глубина истории»: a floor no sync goes below (the opening balance moment included).
      const floorAt =
        typeof account.meta?.historyFrom === 'string' ? new Date(account.meta.historyFrom) : null;
      const floor = new Date(Math.max(opened.getTime(), floorAt?.getTime() ?? 0));
      let mapped: MappedOperation[];
      let fetched = 0;
      let meta = account.meta ?? {};

      if (account.meta?.history === 'positions' && !floorAt) {
        // «Только текущие позиции»: the broker's portfolio now, no history before it.
        progress({
          stage: 'operations',
          accountIndex: index + 1,
          accountCount: accounts.length,
          accountName: account.name,
          percent: Math.round(((index + 1) / accounts.length) * 80),
        });
        mapped = openingBalance(account.externalId, await opts.client.getPortfolio(account.externalId), now);
        meta = { ...meta, historyFrom: now.toISOString() };
      } else {
        const from = last ? new Date(Math.max(last.getTime() - OVERLAP_MS, floor.getTime())) : floor;
        const windows = yearWindows(from < now ? from : now, now);
        const items: OperationItem[] = [];
        for (const [w, window] of windows.entries()) {
          const share = (index + (w + 1) / Math.max(windows.length, 1)) / Math.max(accounts.length, 1);
          progress({
            stage: 'operations',
            accountIndex: index + 1,
            accountCount: accounts.length,
            accountName: account.name,
            year: window.year,
            percent: Math.round(share * 80),
          });
          for await (const page of opts.client.operations({
            accountId: account.externalId,
            from: window.from,
            to: window.to,
          }))
            items.push(...page);
        }
        fetched = items.length;
        const result = mapOperations(items);
        mapped = result.operations;
        if (result.warnings.length)
          opts.log?.warn(
            { accountId: account.id, warnings: result.warnings },
            'T-Invest operations without a mapping rule',
          );
      }
      progress({
        stage: 'instruments',
        accountIndex: index + 1,
        accountCount: accounts.length,
        accountName: account.name,
        percent: Math.round(((index + 1) / accounts.length) * 80),
      });
      const refs = mapped.flatMap((m) => (m.instrument ? [m.instrument] : []));
      const instrumentIds = await resolveInstruments(db, opts.client, refs);
      const result = importOperations(db, account, sourceId, mapped, instrumentIds);
      newOperations += result.inserted;
      relinked += result.relinked;
      db.update(finAccounts)
        .set({ meta: { ...meta, syncedAt: now.toISOString() } })
        .where(eq(finAccounts.id, account.id))
        .run();
      if (result.inserted > 0) enqueueRecalc(db, account.id);
      opts.log?.info({ accountId: account.id, fetched, ...result }, 'T-Invest account synced');
    }

    // FR-REC-1: after every sync, open accounts against the broker. A failure here does not fail the sync.
    for (const [index, account] of accounts.entries()) {
      if (account.meta?.closed) continue;
      progress({
        stage: 'reconcile',
        accountIndex: index + 1,
        accountCount: accounts.length,
        accountName: account.name,
        percent: 90,
      });
      try {
        const tz = getSettings(db, account.userId).display.timezone;
        await reconcileAccount(
          db,
          opts.client,
          { id: account.id, externalId: account.externalId },
          now,
          localDate(now, tz),
        );
      } catch (err) {
        opts.log?.warn({ accountId: account.id, err }, 'Reconcile failed');
      }
    }

    // New securities may have arrived: their coupons and dividends, after positions are recalculated.
    if (newOperations > 0) enqueuePayouts(db, new Date(Date.now() + 30_000));
    const finished = new Date();
    db.update(syncRuns)
      .set({ status: 'ok', finishedAt: finished, newOperations, progress: { stage: 'done', percent: 100 } })
      .where(eq(syncRuns.id, run.id))
      .run();
    db.update(sources)
      .set({ status: 'ok', lastSyncAt: finished, lastError: null })
      .where(eq(sources.id, sourceId))
      .run();
    return { newOperations, relinked, accounts: accounts.length };
  } catch (err) {
    const text = syncErrorText(err, opts.attempt ?? 1);
    db.update(syncRuns)
      .set({ status: 'error', finishedAt: new Date(), error: text })
      .where(eq(syncRuns.id, run.id))
      .run();
    db.update(sources).set({ status: 'error', lastError: text }).where(eq(sources.id, sourceId)).run();
    throw err;
  }
}

export const syncTinvest = defineJob({
  name: SYNC_JOB,
  payload: z.object({ sourceId: z.string().min(1), trigger: z.enum(SYNC_TRIGGERS) }),
  async handler({ db, job, payload, log }) {
    const client = tinvestClient(tinvestToken(db, payload.sourceId));
    const result = await syncSource(db, payload.sourceId, {
      client,
      trigger: payload.trigger,
      attempt: job.attempt,
      log,
    });
    log.info({ sourceId: payload.sourceId, ...result }, 'T-Invest sync done');
  },
});

/** Every few minutes: sources whose schedule says it is time (FR-SRC-1, every 15 minutes by default). */
export function enqueueDueSyncs(db: Executor, now = new Date()): number {
  const due = db
    .select({
      id: sources.id,
      lastSyncAt: sources.lastSyncAt,
      every: sources.scheduleMinutes,
      status: sources.status,
    })
    .from(sources)
    .where(inArray(sources.kind, ['tinvest']))
    .all()
    .filter(
      (s) =>
        s.status !== 'disabled' &&
        s.every &&
        (!s.lastSyncAt || now.getTime() - s.lastSyncAt.getTime() >= s.every * 60_000),
    );
  for (const s of due) enqueueSync(db, s.id, 'schedule');
  return due.length;
}

export const syncDue = defineJob({
  name: SYNC_DUE_JOB,
  payload: z.null(),
  handler({ db }) {
    enqueueDueSyncs(db);
  },
});
