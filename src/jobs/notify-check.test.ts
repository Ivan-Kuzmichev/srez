import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { recalcAccount } from '@/db/mutations/positions';
import { finAccounts, instruments, operations, prices, pricesLast, sources, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { setServiceKey } from '@/server/service-keys';
import { updateSettings } from '@/server/settings';
import {
  MOCK_TELEGRAM_CHAT,
  MOCK_TELEGRAM_TOKEN,
  startTelegramMock,
  type TelegramMock,
} from '../../tests/mock/telegram';
import { checkNotifications } from './notify-check';

let mock: TelegramMock;
beforeAll(async () => {
  mock = await startTelegramMock();
  vi.stubEnv('TELEGRAM_API_URL', mock.url);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await mock.close();
});

// Friday 9 October 2026, 15:00 Moscow.
const now = new Date('2026-10-09T12:00:00Z');

function seeded() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  setServiceKey(db, 'telegram', MOCK_TELEGRAM_TOKEN);
  updateSettings(db, 'u1', { notify: { telegram: { chatId: MOCK_TELEGRAM_CHAT, enabled: true } } });
  const src = db
    .insert(sources)
    .values({ userId: 'u1', kind: 'tinvest', name: 'Т-Инвестиции' })
    .returning()
    .get();
  const acc = db
    .insert(finAccounts)
    .values({ userId: 'u1', sourceId: src.id, name: 'Брокерский', kind: 'broker', currency: 'RUB' })
    .returning()
    .get();
  const sber = db
    .insert(instruments)
    .values({ kind: 'share', assetClass: 'stocks', ticker: 'SBER', name: 'Сбербанк', currency: 'RUB' })
    .returning()
    .get();
  const base = {
    userId: 'u1',
    accountId: acc.id,
    sourceId: src.id,
    origin: 'tinvest' as const,
    currency: 'RUB',
  };
  db.insert(operations)
    .values([
      {
        ...base,
        type: 'deposit',
        amount: '100000',
        executedAt: new Date('2026-09-01T10:00:00Z'),
        createdAt: new Date('2026-09-01T10:00:00Z'),
      },
      {
        ...base,
        type: 'buy',
        instrumentId: sber.id,
        quantity: '100',
        price: '100',
        amount: '-10000',
        executedAt: new Date('2026-09-02T10:00:00Z'),
        createdAt: new Date('2026-09-02T10:00:00Z'),
      },
      {
        ...base,
        type: 'dividend',
        instrumentId: sber.id,
        amount: '870',
        tax: '130',
        executedAt: new Date('2026-10-08T10:00:00Z'),
        createdAt: new Date('2026-10-09T09:00:00Z'),
      },
    ])
    .run();
  recalcAccount(db, acc.id);
  db.insert(prices)
    .values({ instrumentId: sber.id, date: '2026-10-08', close: '100', currency: 'RUB', source: 'moex' })
    .run();
  db.insert(pricesLast)
    .values({ instrumentId: sber.id, price: '110', currency: 'RUB', at: now, source: 'moex' })
    .run();
  return { db, src };
}

// Formatters keep numbers whole with non-breaking spaces; compare with plain ones.
const texts = (from: number) => mock.messages.slice(from).map((m) => m.text.replace(/[\u00a0\u202f]/g, ' '));

describe('notification rules', () => {
  it('each event goes once and again only after its condition cleared and came back', async () => {
    const { db, src } = seeded();
    db.update(sources)
      .set({ status: 'error', lastError: 'API не ответил' })
      .where(eq(sources.id, src.id))
      .run();
    let n = mock.messages.length;
    expect(await checkNotifications(db, 'u1', now)).toMatchObject({ sent: 4 });
    expect(texts(n).sort()).toEqual(
      [
        'Ошибка синхронизации: Т-Инвестиции. API не ответил',
        'Поступила выплата: Дивиденды, Сбербанк, +870 ₽',
        'SBER Сбербанк: +10,0 % за день',
        'Превышен лимит на одну акцию: Сбербанк, 10,8 % при лимите 8,0 %',
      ].sort(),
    );
    n = mock.messages.length;
    expect(await checkNotifications(db, 'u1', now)).toEqual({ sent: 0, cleared: 0 });

    // The sync recovers: the condition clears quietly; a new failure is news again.
    db.update(sources).set({ status: 'ok', lastError: null }).where(eq(sources.id, src.id)).run();
    expect(await checkNotifications(db, 'u1', now)).toEqual({ sent: 0, cleared: 1 });
    db.update(sources)
      .set({ status: 'error', lastError: 'Токен отозван' })
      .where(eq(sources.id, src.id))
      .run();
    expect(await checkNotifications(db, 'u1', now)).toEqual({ sent: 1, cleared: 0 });
    expect(texts(n)).toEqual(['Ошибка синхронизации: Т-Инвестиции. Токен отозван']);
  });

  it('no sums when amounts are masked; the weekly summary on Monday from 10:00; nothing without a bot', async () => {
    const { db } = seeded();
    updateSettings(db, 'u1', {
      logging: { maskAmounts: true },
      notify: { events: { weekly: true, syncError: false } },
      limits: { notify: false },
    });
    const monday = new Date('2026-10-12T07:30:00Z'); // 10:30 in Moscow
    let n = mock.messages.length;
    await checkNotifications(db, 'u1', now);
    expect(texts(n)).toContain('Поступила выплата: Дивиденды, Сбербанк');
    n = mock.messages.length;
    await checkNotifications(db, 'u1', monday);
    const weekly = texts(n).find((t) => t.startsWith('Сводка за неделю'))!;
    expect(weekly).toContain('Все счета');
    expect(weekly).not.toMatch(/₽/);
    expect(await checkNotifications(db, 'u1', new Date('2026-10-12T09:00:00Z'))).toMatchObject({ sent: 0 });

    updateSettings(db, 'u1', { notify: { telegram: { enabled: false } } });
    expect(await checkNotifications(db, 'u1', monday)).toEqual({ sent: 0, cleared: 0 });
  });
});
