'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { replaceTinvestToken } from '@/db/mutations/sources';
import { finAccounts, sources } from '@/db/schema';
import { TinvestError } from '@/integrations/tinvest/client';
import { tinvestClient } from '@/jobs/tinvest-client';
import { enqueueSync, syncErrorText } from '@/jobs/tinvest-sync';
import { ru } from '@/lib/i18n/ru';
import { authedAction } from '../action';
import { logger } from '../logger';

const log = logger('collector');

function ownTinvest(userId: string, sourceId: string) {
  return db()
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.userId, userId), eq(sources.kind, 'tinvest')))
    .get();
}

/** «Синхронизировать сейчас» (FR-SRC-2). */
export const syncNow = authedAction(
  z.object({ sourceId: z.string().min(1) }),
  async ({ sourceId }, session) => {
    if (!ownTinvest(session.user.id, sourceId)) return { ok: false, code: 'NOT_FOUND' };
    enqueueSync(db(), sourceId, 'manual');
    revalidatePath('/', 'layout');
    return { ok: true, data: null };
  },
);

/** «Заменить токен» (FR-SRC-2): checked like in the wizard; the account selection stays. */
export const replaceToken = authedAction(
  z.object({ sourceId: z.string().min(1), token: z.string().trim().min(1).max(500) }),
  async ({ sourceId, token }, session) => {
    const userId = session.user.id;
    if (!ownTinvest(userId, sourceId)) return { ok: false, code: 'NOT_FOUND' };
    let accounts;
    try {
      accounts = await tinvestClient(token).getAccounts({ includeClosed: true });
    } catch (err) {
      log.warn(
        { code: err instanceof TinvestError ? err.code : 'INTERNAL' },
        'T-Invest token replacement failed',
      );
      return { ok: false, code: 'TOKEN', message: syncErrorText(err, 1) };
    }
    if (accounts.some((a) => a.accessLevel === 'ACCOUNT_ACCESS_LEVEL_FULL_ACCESS'))
      return { ok: false, code: 'FULL_ACCESS', message: ru.onboarding.fullAccess };
    const enabled = new Map(
      db()
        .select({ externalId: finAccounts.externalId, syncEnabled: finAccounts.syncEnabled })
        .from(finAccounts)
        .where(eq(finAccounts.sourceId, sourceId))
        .all()
        .map((a) => [a.externalId, a.syncEnabled]),
    );
    db().transaction((tx) => {
      replaceTinvestToken(tx, userId, sourceId, token);
      // Accounts seen for the first time are offered for sync; known ones keep the owner's choice.
      saveBrokerAccounts(tx, userId, sourceId, accounts, (a) => enabled.get(a.id) ?? true);
    });
    enqueueSync(db(), sourceId, 'manual');
    revalidatePath('/', 'layout');
    return { ok: true, data: null };
  },
);

/** «Какие счета синхронизировать». */
export const setAccountSync = authedAction(
  z.object({ accountId: z.string().min(1), enabled: z.boolean() }),
  async ({ accountId, enabled }, session) => {
    const own = db()
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
      .where(
        and(
          eq(finAccounts.id, accountId),
          eq(finAccounts.userId, session.user.id),
          eq(sources.kind, 'tinvest'),
        ),
      )
      .get();
    if (!own) return { ok: false, code: 'NOT_FOUND' };
    db().update(finAccounts).set({ syncEnabled: enabled }).where(eq(finAccounts.id, accountId)).run();
    revalidatePath('/sources');
    return { ok: true, data: null };
  },
);
