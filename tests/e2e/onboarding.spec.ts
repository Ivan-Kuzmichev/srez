import { expect, test } from '@playwright/test';
import { MOCK_TOKEN } from '../mock/tinvest';
import { E2E_ONBOARDING_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

test('the wizard connects T-Invest on the mock and survives a reload while loading', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.fill('input[name=username]', E2E_ONBOARDING_USER.username);
  await page.fill('input[name=password]', E2E_ONBOARDING_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/onboarding');
  const token = page.getByLabel('Токен T-Invest API');
  await token.fill('t.revoked');
  await page.getByRole('button', { name: 'Проверить токен' }).click();
  await expect(page.getByText('Токен не найден или отозван. Выпустите новый')).toBeVisible();

  await token.fill(MOCK_TOKEN);
  await page.getByRole('button', { name: 'Проверить токен' }).click();
  const accounts = page.getByTestId('onboarding-accounts');
  await expect(accounts).toContainText('Брокерский счёт');
  await expect(accounts).toContainText('закрыт в 2023');
  await expect(accounts).toContainText('не поддерживается');
  expect(await page.content()).not.toContain(MOCK_TOKEN);

  await page.getByRole('button', { name: 'Загрузить историю' }).click();
  await expect(page.getByTestId('onboarding-loading')).toBeVisible();
  // The load runs in the worker: a reload lands on the same step.
  await page.reload();
  await expect(page.getByTestId('onboarding-loading').or(page.getByTestId('onboarding-done'))).toBeVisible();
  await expect(page.getByTestId('onboarding-stage').or(page.getByTestId('onboarding-done'))).toBeVisible();

  const done = page.getByTestId('onboarding-done');
  await expect(done).toBeVisible({ timeout: 60_000 });
  await expect(done).toContainText('2020–2026');
  await expect(done).toContainText('31');

  // The fixtures carry two discrepancies on purpose.
  const summary = page.getByTestId('onboarding-reconcile');
  await expect(summary).toContainText('2 позиции не сошлись');
  await expect(page.getByRole('link', { name: 'Разобрать расхождения' })).toBeVisible();
  await page.getByRole('link', { name: 'Разберу позже' }).click();
  await expect(page.getByTestId('overview-value')).toBeVisible();
  await page.goto('/operations?period=all');
  await expect(page.getByTestId('journal-table').first()).toContainText('Т-Инвестиции');

  // «Источники»: status, the run log, a manual sync; the sidebar shows the source.
  await page.goto('/sources');
  const card = page.getByTestId('tinvest-card');
  await expect(card).toContainText('Работает');
  await expect(card).toContainText('Только чтение');
  await expect(page.getByTestId('reconcile-status')).toContainText('2 расхождения');
  await expect(page.getByTestId('sync-log')).toContainText('Успешно');
  await expect(page.getByTestId('sync-card').first()).toContainText('Т-Инвестиции');
  await card.getByRole('button', { name: 'Синхронизировать сейчас' }).click();
  await expect(page.getByText('Синхронизация поставлена в очередь').first()).toBeVisible();
  expect(await page.content()).not.toContain(MOCK_TOKEN);

  // «Разбор расхождений»: the artificial discrepancy is there, a fix closes it, undo brings it back.
  await page.getByTestId('reconcile-status').getByRole('link').click();
  const list = page.getByTestId('reconcile-list');
  await expect(list).toContainText('Газпром');
  await expect(list).toContainText('Лукойл');
  await list.getByRole('link', { name: /Газпром/ }).click();
  await expect(page.getByTestId('reconcile-detail')).toContainText('Газпром');
  await expect(page.getByLabel('Добавить ввод бумаг: 50 шт')).toBeChecked();
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(list).not.toContainText('Газпром');
  const fixed = page.getByTestId('reconcile-fixed');
  await expect(fixed).toContainText('Газпром');
  await page.goto('/operations?period=all');
  await expect(page.getByTestId('journal-table').first()).toContainText('Сверка');
  await page.goBack();
  await fixed.getByRole('button', { name: 'Отменить' }).click();
  await expect(list).toContainText('Газпром');
  await expect(fixed).toHaveCount(0);
});
