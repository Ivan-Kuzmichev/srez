import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, jobs, operations, sources, syncRuns } from '@/db/schema';
import type { SyncSummary } from '@/components/shell/sync-card';
import { ru } from '@/lib/i18n/ru';
import { ago } from '@/lib/relative-date';

export interface TinvestSourceView {
  id: string;
  status: 'ok' | 'error' | 'disabled' | 'running';
  lastError: string | null;
  scheduleMinutes: number;
  lastSyncAt: Date | null;
  operations: number;
  accounts: { id: string; name: string; syncEnabled: boolean; closed: boolean }[];
}

function tinvestSource(db: Db, userId: string) {
  return db
    .select()
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.kind, 'tinvest')))
    .orderBy(desc(sources.createdAt))
    .get();
}

/** A sync job waiting or running for the source. */
function syncing(db: Db, sourceId: string): boolean {
  return (
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(eq(jobs.singletonKey, `sync.tinvest:${sourceId}`), inArray(jobs.status, ['queued', 'running'])),
      )
      .get() !== undefined
  );
}

/** The T-Invest card of «Источники» (FR-SRC-1). Never carries the token. */
export function tinvestSourceView(db: Db, userId: string): TinvestSourceView | null {
  const s = tinvestSource(db, userId);
  if (!s) return null;
  const accounts = db
    .select({
      id: finAccounts.id,
      name: finAccounts.name,
      syncEnabled: finAccounts.syncEnabled,
      closedAt: finAccounts.closedAt,
    })
    .from(finAccounts)
    .where(eq(finAccounts.sourceId, s.id))
    .all()
    .map((a) => ({ id: a.id, name: a.name, syncEnabled: a.syncEnabled, closed: a.closedAt !== null }))
    .sort((a, b) => Number(a.closed) - Number(b.closed));
  return {
    id: s.id,
    status: syncing(db, s.id) ? 'running' : s.status,
    lastError: s.lastError,
    scheduleMinutes: s.scheduleMinutes ?? 15,
    lastSyncAt: s.lastSyncAt,
    operations: db.select({ n: count() }).from(operations).where(eq(operations.sourceId, s.id)).get()?.n ?? 0,
    accounts,
  };
}

export interface SyncLogRow {
  id: number;
  startedAt: Date;
  source: string;
  status: 'running' | 'ok' | 'error';
  error: string | null;
  newOperations: number;
}

/** FR-SRC-3: time, result, new operations, error text. */
export function syncLog(db: Db, userId: string, limit = 20): SyncLogRow[] {
  return db
    .select({
      id: syncRuns.id,
      startedAt: syncRuns.startedAt,
      source: sources.name,
      status: syncRuns.status,
      error: syncRuns.error,
      newOperations: syncRuns.newOperations,
    })
    .from(syncRuns)
    .innerJoin(sources, eq(sources.id, syncRuns.sourceId))
    .where(eq(sources.userId, userId))
    .orderBy(desc(syncRuns.id))
    .limit(limit)
    .all();
}

/** The sidebar card on every screen (FR-SRC-6). */
export function syncSummary(db: Db, userId: string, timeZone: string, now = new Date()): SyncSummary | null {
  const s = tinvestSource(db, userId);
  if (!s) return null;
  if (syncing(db, s.id)) return { name: s.name, state: 'running', detail: ru.shell.syncRunning };
  if (s.status === 'error')
    return { name: s.name, state: 'error', detail: s.lastError ?? ru.shell.syncFailed };
  return {
    name: s.name,
    state: 'ok',
    detail: s.lastSyncAt ? ru.shell.syncedAgo(ago(s.lastSyncAt, timeZone, now)) : ru.sources.never,
  };
}
