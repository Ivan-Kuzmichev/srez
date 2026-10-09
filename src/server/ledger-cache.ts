import { count, eq, inArray, max } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, operations, tagRules } from '@/db/schema';
import { getSettings } from './settings';

/**
 * NFR-4: the journal parsed and replayed once per change, not once per page. The version is cheap to
 * read and moves with anything the replay depends on: operations (count, last change), account default
 * tags, tag rules and «Вычитать комиссии». Values are derived and rebuilt from the journal at will.
 */
export function ledgerVersion(db: Db, userId: string): string {
  const ops = db
    .select({ n: count(), changed: max(operations.updatedAt), created: max(operations.createdAt) })
    .from(operations)
    .where(eq(operations.userId, userId))
    .get();
  const accounts = db
    .select({ id: finAccounts.id, tag: finAccounts.defaultTagId, source: finAccounts.sourceId })
    .from(finAccounts)
    .where(eq(finAccounts.userId, userId))
    .all();
  const rules = accounts.length
    ? db
        .select({ a: tagRules.accountId, i: tagRules.instrumentId, t: tagRules.tagId })
        .from(tagRules)
        .where(
          inArray(
            tagRules.accountId,
            accounts.map((a) => a.id),
          ),
        )
        .all()
    : [];
  return JSON.stringify([ops, accounts, rules, getSettings(db, userId).returns.deductFees]);
}

const cache = new Map<string, { version: string; value: unknown }>();

/** The value of `build` for this user and name, built again only when the journal changed. */
export function memoByLedger<T>(db: Db, userId: string, name: string, build: () => T): T {
  const key = `${userId}|${name}`;
  const version = ledgerVersion(db, userId);
  const hit = cache.get(key);
  if (hit && hit.version === version) return hit.value as T;
  const value = build();
  cache.set(key, { version, value });
  return value;
}
