'use server';

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { isClosedAccount, isSupportedAccount, saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { createTinvestSource, replaceTinvestToken } from '@/db/mutations/sources';
import { finAccounts, operations, sources } from '@/db/schema';
import { TinvestError } from '@/integrations/tinvest/client';
import { tinvestClient } from '@/jobs/tinvest-client';
import { enqueueSync, syncErrorText } from '@/jobs/tinvest-sync';
import { ru } from '@/lib/i18n/ru';
import { authedAction } from '../action';
import { logger } from '../logger';

const log = logger('collector');

export interface CheckedAccounts {
  unsupported: { name: string }[];
}

/**
 * Step 1 (FR-ONB-2): the token is checked against the API right here, from the form, and only a
 * read-only one is kept, encrypted. The plain token never leaves this request.
 */
export const connectTinvest = authedAction(
  z.object({ token: z.string().trim().min(1, ru.onboarding.tokenRequired).max(500) }),
  async ({ token }, session) => {
    let accounts;
    try {
      accounts = await tinvestClient(token).getAccounts({ includeClosed: true });
    } catch (err) {
      log.warn({ code: err instanceof TinvestError ? err.code : 'INTERNAL' }, 'T-Invest token check failed');
      return { ok: false, code: 'TOKEN', message: syncErrorText(err, 1) };
    }
    if (accounts.length === 0) return { ok: false, code: 'TOKEN', message: ru.onboarding.noAccounts };
    if (accounts.some((a) => a.accessLevel === 'ACCOUNT_ACCESS_LEVEL_FULL_ACCESS'))
      return { ok: false, code: 'FULL_ACCESS', message: ru.onboarding.fullAccess };

    const userId = session.user.id;
    db().transaction((tx) => {
      const existing = tx
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.userId, userId), eq(sources.kind, 'tinvest')))
        .orderBy(desc(sources.createdAt))
        .get();
      const sourceId = existing?.id ?? createTinvestSource(tx, userId, token);
      if (existing) replaceTinvestToken(tx, userId, existing.id, token);
      // Every supported account is offered checked, closed ones too: their history counts.
      saveBrokerAccounts(tx, userId, sourceId, accounts, () => true);
    });
    log.info(
      { accounts: accounts.length, closed: accounts.filter(isClosedAccount).length },
      'T-Invest token saved',
    );
    return {
      ok: true,
      data: {
        unsupported: accounts.filter((a) => !isSupportedAccount(a)).map((a) => ({ name: a.name || a.type })),
      } satisfies CheckedAccounts,
    };
  },
);

/** Step 2: the chosen accounts and depth; the first sync goes to the worker (FR-ONB-3). */
export const startTinvestImport = authedAction(
  z.object({
    accountIds: z.array(z.string().min(1)).min(1, ru.onboarding.pickAccount).max(50),
    depth: z.enum(['all', 'year', 'positions']),
  }),
  async ({ accountIds, depth }, session) => {
    const userId = session.user.id;
    const source = db()
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.userId, userId), eq(sources.kind, 'tinvest')))
      .orderBy(desc(sources.createdAt))
      .get();
    if (!source) return { ok: false, code: 'NO_SOURCE' };
    const own = db()
      .select({ id: finAccounts.id, meta: finAccounts.meta })
      .from(finAccounts)
      .where(eq(finAccounts.sourceId, source.id))
      .all();
    const chosen = new Set(accountIds);
    if (accountIds.some((id) => !own.some((a) => a.id === id))) return { ok: false, code: 'NOT_FOUND' };
    const floor = depth === 'year' ? `${new Date().getUTCFullYear()}-01-01T00:00:00.000Z` : undefined;

    db().transaction((tx) => {
      for (const a of own) {
        // The depth applies to accounts not imported yet: changing it later would count holdings twice.
        const imported =
          tx.select({ id: operations.id }).from(operations).where(eq(operations.accountId, a.id)).get() !==
          undefined;
        const { historyFrom: _from, history: _history, ...rest } = a.meta ?? {};
        const meta = imported
          ? (a.meta ?? {})
          : {
              ...rest,
              ...(floor ? { historyFrom: floor } : {}),
              ...(depth === 'positions' ? { history: 'positions' } : {}),
            };
        tx.update(finAccounts)
          .set({ syncEnabled: chosen.has(a.id), meta })
          .where(eq(finAccounts.id, a.id))
          .run();
      }
      enqueueSync(tx, source.id, 'onboarding');
    });
    return { ok: true, data: null };
  },
);

/** Step 3 after an error: the same accounts once more. */
export const retryTinvestImport = authedAction(z.object({}), async (_input, session) => {
  const source = db()
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, session.user.id), eq(sources.kind, 'tinvest')))
    .orderBy(desc(sources.createdAt))
    .get();
  if (!source) return { ok: false, code: 'NO_SOURCE' };
  enqueueSync(db(), source.id, 'onboarding');
  return { ok: true, data: null };
});
