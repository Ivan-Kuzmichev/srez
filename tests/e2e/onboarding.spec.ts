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

  await page.getByRole('link', { name: 'Перейти к обзору' }).click();
  await expect(page.getByTestId('overview-value')).toBeVisible();
  await page.goto('/operations?period=all');
  await expect(page.getByTestId('journal-table')).toContainText('Т-Инвестиции');
});
