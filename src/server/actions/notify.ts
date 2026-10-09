'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  sendTelegram,
  TELEGRAM_CHAT_RE,
  TELEGRAM_TOKEN_RE,
  telegramFailure,
} from '@/integrations/telegram/client';
import { enqueueTelegramTest } from '@/jobs/notify-send';
import { APP_NAME } from '@/lib/app';
import { ru } from '@/lib/i18n/ru';
import { authedAction } from '../action';
import { logger } from '../logger';
import { removeServiceKey, setServiceKey } from '../service-keys';
import { updateSettings } from '../settings';

/** FR-NTF-1: the test message goes while the token is still in plain text here; only then it is stored. */
export const connectTelegram = authedAction(
  z.object({
    token: z.string().trim().regex(TELEGRAM_TOKEN_RE),
    chatId: z.string().trim().regex(TELEGRAM_CHAT_RE),
  }),
  async ({ token, chatId }, session) => {
    try {
      await sendTelegram(token, chatId, ru.notify.test(APP_NAME));
    } catch (err) {
      return { ok: false, code: telegramFailure(err) };
    }
    setServiceKey(db(), 'telegram', token);
    updateSettings(db(), session.user.id, {
      notify: { telegram: { chatId, enabled: true, lastSentAt: Date.now(), lastError: null } },
    });
    logger('notify').info('Telegram connected');
    revalidatePath('/settings');
    return { ok: true, data: null };
  },
);

/** «Отправить проверочное сообщение»: the stored token is decrypted only in the worker. */
export const testTelegram = authedAction(z.null(), async (_input, session) => {
  enqueueTelegramTest(db(), session.user.id);
  return { ok: true, data: null };
});

export const disconnectTelegram = authedAction(z.null(), async (_input, session) => {
  removeServiceKey(db(), 'telegram');
  updateSettings(db(), session.user.id, {
    notify: { telegram: { chatId: null, enabled: false, lastError: null } },
  });
  logger('notify').info('Telegram disconnected');
  revalidatePath('/settings');
  return { ok: true, data: null };
});
