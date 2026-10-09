import { z } from 'zod';
import type { Executor } from '@/db/client';
import { sendTelegram, telegramFailure } from '@/integrations/telegram/client';
import type { Fetch } from '@/integrations/errors';
import { APP_NAME } from '@/lib/app';
import { ru } from '@/lib/i18n/ru';
import { getSettings, updateSettings } from '@/server/settings';
import { enqueue } from './queue';
import { defineJob } from './runner';
import { serviceKey } from './source-token';

export const NOTIFY_TEST_JOB = 'notify.test';

/**
 * One message to the owner's chat. Returns whether it went; the outcome is kept in the settings
 * (`lastSentAt`, `lastError`) for the card. Without a connected bot nothing is sent.
 */
export async function sendToOwner(
  db: Executor,
  userId: string,
  text: string,
  fetchFn?: Fetch,
): Promise<boolean> {
  const tg = getSettings(db, userId).notify.telegram;
  const token = tg.enabled && tg.chatId ? serviceKey(db, 'telegram') : null;
  if (!token || !tg.chatId) return false;
  try {
    await sendTelegram(token, tg.chatId, text, fetchFn);
    updateSettings(db, userId, { notify: { telegram: { lastSentAt: Date.now(), lastError: null } } });
    return true;
  } catch (err) {
    updateSettings(db, userId, { notify: { telegram: { lastError: telegramFailure(err) } } });
    return false;
  }
}

export function enqueueTelegramTest(db: Executor, userId: string): number | null {
  return enqueue(db, NOTIFY_TEST_JOB, { userId }, { singletonKey: `${NOTIFY_TEST_JOB}:${userId}` });
}

export const telegramTestJob = defineJob({
  name: NOTIFY_TEST_JOB,
  payload: z.object({ userId: z.string().min(1) }),
  async handler({ db, payload, log }) {
    const ok = await sendToOwner(db, payload.userId, ru.notify.test(APP_NAME));
    log.info({ ok }, 'Telegram test message');
  },
});
