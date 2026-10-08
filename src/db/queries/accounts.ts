import { and, asc, count, eq, max } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, operations, sources, tags } from '@/db/schema';

export interface AccountOption {
  id: string;
  name: string;
  kind: (typeof finAccounts.$inferSelect)['kind'];
  currency: string;
  sourceKind: (typeof sources.$inferSelect)['kind'];
  defaultTagId: string | null;
}

/** Every account of the user, for selects and filters. */
export function listAccounts(db: Db, userId: string): AccountOption[] {
  return db
    .select({
      id: finAccounts.id,
      name: finAccounts.name,
      kind: finAccounts.kind,
      currency: finAccounts.currency,
      sourceKind: sources.kind,
      defaultTagId: finAccounts.defaultTagId,
    })
    .from(finAccounts)
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .where(eq(finAccounts.userId, userId))
    .orderBy(asc(finAccounts.name))
    .all();
}

export interface ManualAccountRow {
  id: string;
  name: string;
  kind: (typeof finAccounts.$inferSelect)['kind'];
  currency: string;
  operations: number;
  lastOperationAt: Date | null;
}

/** Manual accounts with their operation count and the latest entry (Sources, «Ручные счета»). */
export function listManualAccounts(db: Db, userId: string): ManualAccountRow[] {
  return db
    .select({
      id: finAccounts.id,
      name: finAccounts.name,
      kind: finAccounts.kind,
      currency: finAccounts.currency,
      operations: count(operations.id),
      lastOperationAt: max(operations.executedAt),
    })
    .from(finAccounts)
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .leftJoin(operations, eq(operations.accountId, finAccounts.id))
    .where(and(eq(finAccounts.userId, userId), eq(sources.kind, 'manual')))
    .groupBy(finAccounts.id)
    .orderBy(asc(finAccounts.name))
    .all()
    .map((r) => ({ ...r, lastOperationAt: r.lastOperationAt ? new Date(r.lastOperationAt) : null }));
}

export function listTags(db: Db, userId: string): { id: string; name: string }[] {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(tags.name))
    .all();
}
