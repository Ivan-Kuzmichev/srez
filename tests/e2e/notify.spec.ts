import { expect, test } from '@playwright/test';
import { MOCK_TELEGRAM_CHAT, MOCK_TELEGRAM_TOKEN } from '../mock/telegram';

const MOCK = 'http://127.0.0.1:3197';
const sent = async () => ((await (await fetch(`${MOCK}/messages`)).json()) as { text: string }[]).length;

test('Telegram: a refused token is not kept; the right one sends a test message, then again from the worker', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/settings');
  const card = page.getByTestId('settings-notify');
  await expect(card).toContainText('Бот не подключён');
  await card.getByRole('button', { name: 'Подключить' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Токен бота').fill('123456789:AAEwrongTokenwrongTokenwrongToken12');
  await dialog.getByLabel('chat_id').fill(MOCK_TELEGRAM_CHAT);
  await dialog.getByRole('button', { name: 'Проверить и подключить' }).click();
  await expect(dialog).toContainText('Telegram не принял токен бота');

  const before = await sent();
  await dialog.getByLabel('Токен бота').fill(MOCK_TELEGRAM_TOKEN);
  await dialog.getByRole('button', { name: 'Проверить и подключить' }).click();
  await expect(card).toContainText('Бот подключён');
  expect(await sent()).toBe(before + 1);
  expect(await page.content()).not.toContain(MOCK_TELEGRAM_TOKEN);

  await card.getByRole('button', { name: 'Отправить проверочное сообщение' }).click();
  await expect.poll(sent, { timeout: 20_000 }).toBe(before + 2);
});
