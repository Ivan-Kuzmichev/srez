import { and, eq } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { finAccounts } from '@/db/schema';
import type { Account } from '@/integrations/tinvest/client';
import { ru } from '@/lib/i18n/ru';

/** DFA accounts have no positions in the API (50004); an account without access is useless. */
export function isSupportedAccount(a: Pick<Account, 'type' | 'accessLevel'>): boolean {
  return a.type !== 'ACCOUNT_TYPE_DFA' && a.accessLevel !== 'ACCOUNT_ACCESS_LEVEL_NO_ACCESS';
}

export const isClosedAccount = (a: Pick<Account, 'status'>) => a.status === 'ACCOUNT_STATUS_CLOSED';

const KIND: Record<string, (typeof finAccounts.$inferInsert)['kind']> = {
  ACCOUNT_TYPE_TINKOFF: 'broker',
  ACCOUNT_TYPE_TINKOFF_IIS: 'iis',
  ACCOUNT_TYPE_INVEST_BOX: 'broker',
};

function defaultName(a: Account): string {
  if (a.name) return a.name;
  if (a.type === 'ACCOUNT_TYPE_TINKOFF_IIS') return ru.tinvest.accountKinds.iis;
  if (a.type === 'ACCOUNT_TYPE_INVEST_BOX') return ru.tinvest.accountKinds.investBox;
  return ru.tinvest.accountKinds.broker;
}

const day = (d: Date | undefined) => (d && d.getTime() > 0 ? d.toISOString().slice(0, 10) : null);

/**
 * Broker accounts become journal accounts, matched by (source, broker id). A name the owner changed
 * stays; the selection and the broker's dates are refreshed. Returns broker id → account id.
 */
export function saveBrokerAccounts(
  db: Executor,
  userId: string,
  sourceId: string,
  accounts: Account[],
  enabled: (a: Account) => boolean,
): Map<string, string> {
  const ids = new Map<string, string>();
  for (const a of accounts.filter(isSupportedAccount)) {
    const fields = {
      syncEnabled: enabled(a),
      openedAt: day(a.openedDate),
      closedAt: isClosedAccount(a) ? day(a.closedDate) : null,
    };
    const existing = db
      .select({ id: finAccounts.id, meta: finAccounts.meta })
      .from(finAccounts)
      .where(and(eq(finAccounts.sourceId, sourceId), eq(finAccounts.externalId, a.id)))
      .get();
    if (existing) {
      db.update(finAccounts)
        .set({ ...fields, meta: { ...existing.meta, tinvestType: a.type, closed: isClosedAccount(a) } })
        .where(eq(finAccounts.id, existing.id))
        .run();
      ids.set(a.id, existing.id);
      continue;
    }
    const row = db
      .insert(finAccounts)
      .values({
        userId,
        sourceId,
        externalId: a.id,
        name: defaultName(a),
        kind: KIND[a.type] ?? 'other',
        currency: 'RUB',
        ...fields,
        meta: { tinvestType: a.type, closed: isClosedAccount(a) },
      })
      .returning({ id: finAccounts.id })
      .get();
    ids.set(a.id, row.id);
  }
  return ids;
}
