import { expect, test, type Page } from '@playwright/test';
import { E2E_PORTFOLIO_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name=username]', E2E_PORTFOLIO_USER.username);
  await page.fill('input[name=password]', E2E_PORTFOLIO_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
}

async function createPortfolio(page: Page, name: string, mode: 'По тегу' | 'Целиком') {
  await page.goto('/portfolios/new');
  await page.getByLabel('Название').fill(name);
  await page.getByLabel('Как входит счёт Брокерский').click();
  await page.getByRole('option', { name: mode }).click();
  if (mode === 'По тегу') {
    await page.getByLabel('Тег для счёта Брокерский').click();
    await page.getByRole('option', { name: 'пенсия' }).click();
  }
  await expect(page.getByTestId('portfolio-preview')).toContainText('Позиций');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page).toHaveURL(/\/portfolios\/[0-9a-f-]+$/);
}

test('a tag portfolio shows only its positions, a whole-account one shows all; deleting keeps operations', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(90_000);
  await signIn(page);
  // The worker recalculates positions on start; wait until they exist.
  await expect(async () => {
    await page.goto('/portfolios/new');
    await page.getByLabel('Как входит счёт Брокерский').click();
    await page.getByRole('option', { name: 'Целиком' }).click();
    await expect(page.getByTestId('portfolio-preview')).toContainText(/Позиций\s*2/);
  }).toPass({ timeout: 30_000 });

  await createPortfolio(page, 'Пенсия', 'По тегу');
  const tagPositions = page.getByTestId('positions');
  await expect(tagPositions).toContainText('SBER');
  await expect(tagPositions).not.toContainText('LKOH');
  await expect(tagPositions).not.toContainText('RUB');

  await createPortfolio(page, 'Всё', 'Целиком');
  const all = page.getByTestId('positions');
  await expect(all).toContainText('SBER');
  await expect(all).toContainText('LKOH');
  await expect(all).toContainText('RUB');

  await page.goto('/portfolios');
  await expect(page.getByTestId('portfolio-cards')).toContainText('Пенсия');
  await expect(page.getByTestId('accounts-table')).toContainText('Пенсия, тег «пенсия»');

  await page
    .getByTestId('portfolio-cards')
    .getByRole('link', { name: /Пенсия/ })
    .click();
  await page.getByRole('link', { name: 'Состав и цели' }).click();
  await page.getByRole('button', { name: 'Удалить портфель' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить портфель' }).click();
  await expect(page).toHaveURL(/\/portfolios$/);
  await expect(page.getByTestId('portfolio-cards')).not.toContainText('Пенсия');
  await page.goto('/operations?period=all');
  await expect(page.getByTestId('journal-table').locator('tbody tr')).toHaveCount(3);
});

test('the overview switches the display currency, and price settings persist', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await signIn(page);
  await expect(page.getByTestId('overview-value')).toContainText('₽');
  await page.getByRole('radio', { name: 'Доллары' }).click();
  await expect(page).toHaveURL(/cur=USD/);
  await expect(page.getByTestId('overview-value')).toContainText('$');

  await page.goto('/settings');
  await page.getByLabel('Ежедневный снимок стоимости').fill('22:30');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены').first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Ежедневный снимок стоимости')).toHaveValue('22:30');
});
