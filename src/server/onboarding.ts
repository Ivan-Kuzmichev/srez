import { and, count, desc, eq, inArray, isNotNull, max, min } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  finAccounts,
  instruments,
  jobs,
  operations,
  positions,
  sources,
  syncRuns,
  type SyncProgress,
} from '@/db/schema';
import { Decimal } from '@/domain/decimal';

export type OnboardingStep = 1 | 2 | 3 | 4;

export interface OnboardingAccount {
  id: string;
  name: string;
  openedYear: number | null;
  closedYear: number | null;
  syncEnabled: boolean;
}

export interface OnboardingState {
  step: OnboardingStep;
  sourceId: string | null;
  accounts: OnboardingAccount[];
  run: {
    status: 'running' | 'ok' | 'error';
    progress: SyncProgress | null;
    error: string | null;
    startedAt: Date;
  } | null;
  /** A sync job waits in the queue and has not started a run yet. */
  queued: boolean;
  stats: {
    operations: number;
    instruments: number;
    fromYear: number | null;
    toYear: number | null;
    positions: number;
  };
}

const year = (d: string | null) => (d ? Number(d.slice(0, 4)) : null);

/**
 * Where the wizard stands, from the database alone, so a reload or another device lands on the
 * same step (FR-ONB-3). `requested` lets «Назад» open an earlier step.
 */
export function onboardingState(db: Db, userId: string, requested?: number): OnboardingState {
  const source = db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.kind, 'tinvest')))
    .orderBy(desc(sources.createdAt))
    .get();
  const empty = { operations: 0, instruments: 0, fromYear: null, toYear: null, positions: 0 };
  if (!source) return { step: 1, sourceId: null, accounts: [], run: null, queued: false, stats: empty };

  const accounts = db
    .select({
      id: finAccounts.id,
      name: finAccounts.name,
      openedAt: finAccounts.openedAt,
      closedAt: finAccounts.closedAt,
      syncEnabled: finAccounts.syncEnabled,
    })
    .from(finAccounts)
    .where(eq(finAccounts.sourceId, source.id))
    .all()
    .map((a) => ({
      id: a.id,
      name: a.name,
      openedYear: year(a.openedAt),
      closedYear: year(a.closedAt),
      syncEnabled: a.syncEnabled,
    }))
    .sort(
      (a, b) =>
        Number(a.closedYear !== null) - Number(b.closedYear !== null) ||
        (a.openedYear ?? 0) - (b.openedYear ?? 0),
    );

  const run = db
    .select({
      status: syncRuns.status,
      progress: syncRuns.progress,
      error: syncRuns.error,
      startedAt: syncRuns.startedAt,
    })
    .from(syncRuns)
    .where(eq(syncRuns.sourceId, source.id))
    .orderBy(desc(syncRuns.id))
    .get();
  const queued =
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(eq(jobs.singletonKey, `sync.tinvest:${source.id}`), inArray(jobs.status, ['queued', 'running'])),
      )
      .get() !== undefined;

  const span = db
    .select({ n: count(), from: min(operations.executedAt), to: max(operations.executedAt) })
    .from(operations)
    .where(eq(operations.sourceId, source.id))
    .get();
  const instrumentCount = db
    .selectDistinct({ id: operations.instrumentId })
    .from(operations)
    .innerJoin(instruments, eq(instruments.id, operations.instrumentId))
    .where(and(eq(operations.sourceId, source.id), isNotNull(operations.instrumentId)))
    .all().length;
  const ids = accounts.map((a) => a.id);
  const held = ids.length
    ? db
        .select({ quantity: positions.quantity, kind: instruments.kind })
        .from(positions)
        .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
        .where(inArray(positions.accountId, ids))
        .all()
        .filter((p) => p.kind !== 'currency' && new Decimal(p.quantity).gt(0)).length
    : 0;
  const stats = {
    operations: span?.n ?? 0,
    instruments: instrumentCount,
    fromYear: span?.from ? new Date(span.from).getUTCFullYear() : null,
    toYear: span?.to ? new Date(span.to).getUTCFullYear() : null,
    positions: held,
  };

  let step: OnboardingStep;
  if (!run && !queued) step = 2;
  else if (queued || run?.status !== 'ok') step = 3;
  else step = 4;
  if (requested === 1 || (requested === 2 && step !== 3)) step = requested;
  return { step, sourceId: source.id, accounts, run: run ?? null, queued, stats };
}
