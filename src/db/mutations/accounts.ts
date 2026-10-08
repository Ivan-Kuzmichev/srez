import { and, eq } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { finAccounts, sources, tags } from '@/db/schema';

/** The user's «manual» source, created with the first manual account. */
export function ensureManualSource(db: Executor, userId: string): string {
  const existing = db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.kind, 'manual')))
    .get();
  if (existing) return existing.id;
  return db
    .insert(sources)
    .values({ userId, kind: 'manual', name: 'Вручную' })
    .returning({ id: sources.id })
    .get().id;
}

export interface NewManualAccount {
  name: string;
  kind: (typeof finAccounts.$inferInsert)['kind'];
  currency: string;
  defaultTagId: string | null;
}

export function createManualAccount(db: Executor, userId: string, input: NewManualAccount): string {
  return db.transaction((tx) => {
    const sourceId = ensureManualSource(tx, userId);
    if (input.defaultTagId) assertOwnTag(tx, userId, input.defaultTagId);
    return tx
      .insert(finAccounts)
      .values({
        userId,
        sourceId,
        name: input.name,
        kind: input.kind,
        currency: input.currency,
        defaultTagId: input.defaultTagId,
      })
      .returning({ id: finAccounts.id })
      .get().id;
  });
}

export function assertOwnTag(db: Executor, userId: string, tagId: string): void {
  const own = db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
    .get();
  if (!own) throw new Error('Tag not found');
}

/** Same name gives the same tag: tags are unique per user. */
export function createTag(db: Executor, userId: string, name: string): { id: string; name: string } {
  const existing = db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, name)))
    .get();
  if (existing) return existing;
  return db.insert(tags).values({ userId, name }).returning({ id: tags.id, name: tags.name }).get();
}
