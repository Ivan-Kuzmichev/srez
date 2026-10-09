import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { sendTelegram, telegramFailure } from '@/integrations/telegram/client';
import { setServiceKey } from '@/server/service-keys';
import { getSettings, updateSettings } from '@/server/settings';
import {
  MOCK_TELEGRAM_CHAT,
  MOCK_TELEGRAM_TOKEN,
  startTelegramMock,
  type TelegramMock,
} from '../../tests/mock/telegram';
import { sendToOwner } from './notify-send';

let mock: TelegramMock;
beforeAll(async () => {
  mock = await startTelegramMock();
  vi.stubEnv('TELEGRAM_API_URL', mock.url);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await mock.close();
});

describe('telegram', () => {
  it('sends; a wrong token and an unknown chat are told apart', async () => {
    await sendTelegram(MOCK_TELEGRAM_TOKEN, MOCK_TELEGRAM_CHAT, 'привет');
    expect(mock.messages.at(-1)).toEqual({ chatId: MOCK_TELEGRAM_CHAT, text: 'привет' });
    const fail = (token: string, chat: string) =>
      sendTelegram(token, chat, 'x').catch((e) => telegramFailure(e));
    expect(await fail('1:wrong', MOCK_TELEGRAM_CHAT)).toBe('TOKEN');
    expect(await fail(MOCK_TELEGRAM_TOKEN, '42')).toBe('CHAT');
  });

  it('the owner gets a message only with a connected bot; the outcome is kept for the card', async () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(user)
      .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
      .run();
    expect(await sendToOwner(db, 'u1', 'не уйдёт')).toBe(false);
    setServiceKey(db, 'telegram', MOCK_TELEGRAM_TOKEN);
    updateSettings(db, 'u1', { notify: { telegram: { chatId: MOCK_TELEGRAM_CHAT, enabled: true } } });
    expect(await sendToOwner(db, 'u1', 'выплата')).toBe(true);
    expect(getSettings(db, 'u1').notify.telegram).toMatchObject({
      lastError: null,
      lastSentAt: expect.any(Number),
    });
    updateSettings(db, 'u1', { notify: { telegram: { chatId: '42' } } });
    expect(await sendToOwner(db, 'u1', 'не дойдёт')).toBe(false);
    expect(getSettings(db, 'u1').notify.telegram.lastError).toBe('CHAT');
  });
});
