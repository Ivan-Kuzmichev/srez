import { expect, test, type Page } from '@playwright/test';
import { positionOf } from './db';
import { E2E_EMPTY_USER, E2E_LEDGER_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, user: { username: string; password: string }) {
  await page.goto('/login');
  await page.fill('input[name=username]', user.username);
  await page.fill('input[name=password]', user.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
}

test('an empty journal offers to connect or enter by hand', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await signIn(page, E2E_EMPTY_USER);
  await page.goto('/operations');
  await expect(page.getByRole('heading', { name: 'Операций пока нет' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Внести вручную/ })).toHaveAttribute('href', '/operations/new');
});

test('reference 1.1 entered by hand gives the same position; deleting recalculates', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(120_000);
  await signIn(page, E2E_LEDGER_USER);

  // A manual account first.
  await page.goto('/sources');
  await page.getByRole('button', { name: 'Добавить счёт' }).click();
  await page.getByRole('dialog').getByLabel('Название').fill('Брокерский');
  await page.getByRole('dialog').getByRole('button', { name: 'Добавить счёт' }).click();
  await expect(page.getByTestId('manual-accounts')).toContainText('Брокерский');

  const buys: [string, string][] = [
    ['500', '251,00'],
    ['400', '271,20'],
    ['200', '284,45'],
    ['100', '312,10'],
  ];
  await page.goto('/operations/new');
  for (const [i, [qty, price]] of buys.entries()) {
    await page.getByLabel('Актив').fill('SBER');
    await page.getByRole('option', { name: /SBER/ }).first().click();
    await page.getByLabel('Количество').fill(qty);
    await page.getByLabel('Цена за единицу').fill(price);
    if (i === 3) {
      // «Что изменится» before the last purchase: 1 100 → 1 200, average → 268,40.
      const preview = page.getByTestId('preview');
      await expect(preview).toContainText('1 100 → 1 200');
      await expect(preview).toContainText('268,40');
    }
    await page.getByRole('button', { name: 'Сохранить и добавить ещё' }).click();
    await expect(page.getByText('Сохранено. Вносите следующую').first()).toBeVisible();
    await expect(page.getByLabel('Количество')).toHaveValue('');
  }

  await expect
    .poll(() => positionOf(E2E_LEDGER_USER.username, 'SBER'), { timeout: 15_000 })
    .toEqual({ quantity: '1200', costBasis: '322080', avgPrice: '268.4' });

  await page.goto('/operations');
  const table = page.getByTestId('journal-table');
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('journal-totals')).toContainText('−322 080 ₽');

  // Delete the 100 × 312,10 purchase: the position follows.
  const row = table.locator('tbody tr', { hasText: '312,10' });
  await row.getByRole('button', { name: 'Действия с операцией' }).click();
  await page.getByRole('menuitem', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect
    .poll(() => positionOf(E2E_LEDGER_USER.username, 'SBER'), { timeout: 15_000 })
    .toMatchObject({ quantity: '1100', costBasis: '290870' });

  // Filters live in the address bar.
  await page.getByLabel('Поиск', { exact: true }).fill('sber');
  await expect(page).toHaveURL(/q=sber/);
  await page.goto('/operations?type=payout');
  await expect(page.getByRole('heading', { name: 'По фильтрам ничего не найдено' })).toBeVisible();
  await page.getByRole('link', { name: 'Сбросить фильтры' }).click();
  await expect(page).toHaveURL(/\/operations$/);
  await expect(table.locator('tbody tr')).toHaveCount(3);
});
