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

test('«Данные»: the journal as CSV and a database backup without sessions', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/settings');
  const data = page.getByTestId('settings-data');
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('link', { name: 'Выгрузить операции в CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^srez-operations-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = Buffer.concat(await (await csv.createReadStream()).toArray()).toString('utf8');
  expect(text.startsWith('﻿Дата;Операция;')).toBe(true);

  const [backup] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('link', { name: 'Скачать резервную копию' }).click(),
  ]);
  expect(backup.suggestedFilename()).toMatch(/^srez-backup-.*\.db$/);
  const head = Buffer.concat(await (await backup.createReadStream()).toArray())
    .subarray(0, 15)
    .toString('latin1');
  expect(head).toBe('SQLite format 3');
});
