import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  discrepancies,
  finAccounts,
  instruments,
  jobs,
  operations,
  positions,
  sources,
  syncRuns,
} from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { SyncSummary } from '@/components/shell/sync-card';
import { ru } from '@/lib/i18n/ru';
import { ago } from '@/lib/relative-date';
import type { WalletMeta } from './wallets';

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

export interface ReconcileSummary {
  /** Securities checked against the broker that agree. */
  matched: number;
  /** Discrepancies waiting for the owner (cash included). */
  open: number;
}

/** For the wizard's last step and the «Сверка с брокером» block. */
export function reconcileSummary(db: Db, sourceId: string): ReconcileSummary {
  const accountIds = db
    .select({ id: finAccounts.id, closedAt: finAccounts.closedAt })
    .from(finAccounts)
    .where(eq(finAccounts.sourceId, sourceId))
    .all()
    .filter((a) => a.closedAt === null)
    .map((a) => a.id);
  if (accountIds.length === 0) return { matched: 0, open: 0 };
  const open = db
    .select({ instrumentId: discrepancies.instrumentId, kind: instruments.kind })
    .from(discrepancies)
    .innerJoin(instruments, eq(instruments.id, discrepancies.instrumentId))
    .where(and(inArray(discrepancies.accountId, accountIds), eq(discrepancies.status, 'open')))
    .all();
  const held = db
    .select({
      accountId: positions.accountId,
      instrumentId: positions.instrumentId,
      quantity: positions.quantity,
      kind: instruments.kind,
    })
    .from(positions)
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .where(inArray(positions.accountId, accountIds))
    .all()
    .filter((p) => p.kind !== 'currency' && new Decimal(p.quantity).gt(0));
  const pairs = new Set(held.map((p) => `${p.accountId}|${p.instrumentId}`));
  const openSecurities = open.filter((d) => d.kind !== 'currency').length;
  return { matched: Math.max(0, pairs.size - openSecurities), open: open.length };
}

export interface WalletSourceView {
  id: string;
  name: string;
  status: string;
  lastError: string | null;
  lastSyncAt: Date | null;
  address: string;
  networks: string[];
  mode: 'history' | 'balances';
}

/** Wallets on «Источники»: one source each, with its account's address and networks. */
export function walletSources(db: Db, userId: string): WalletSourceView[] {
  return db
    .select({
      id: sources.id,
      name: sources.name,
      status: sources.status,
      lastError: sources.lastError,
      lastSyncAt: sources.lastSyncAt,
      meta: finAccounts.meta,
    })
    .from(sources)
    .innerJoin(finAccounts, eq(finAccounts.sourceId, sources.id))
    .where(and(eq(sources.userId, userId), eq(sources.kind, 'wallet')))
    .all()
    .flatMap((r) => {
      const w = (r.meta as Partial<WalletMeta> | null)?.wallet;
      return w ? [{ ...r, address: w.address, networks: w.networks, mode: w.mode }] : [];
    });
}
