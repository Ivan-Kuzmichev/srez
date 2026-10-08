import { expect, test, type Browser } from '@playwright/test';
import { E2E_SESSIONS_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(browser: Browser, password: string, userAgent?: string) {
  const context = await browser.newContext({ userAgent, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.fill('input[name=username]', E2E_SESSIONS_USER.username);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  return page;
}

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

test('sessions list, ending one, then changing the password ends the rest', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop');
  const phone = await signIn(browser, E2E_SESSIONS_USER.password, IPHONE);
  await expect(phone).toHaveURL(/\/$/);
  const second = await signIn(browser, E2E_SESSIONS_USER.password, IPHONE);
  await expect(second).toHaveURL(/\/$/);
  const page = await signIn(browser, E2E_SESSIONS_USER.password);
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings/security');
  const table = page.getByTestId('sessions').locator('table');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table).toContainText('это устройство');
  await expect(table).toContainText('Safari, iPhone');

  // End one iPhone session from here.
  await table.getByRole('button', { name: 'Завершить' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Завершить' }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);

  // Wrong current password keeps the dialog open with an error.
  await page.getByRole('button', { name: 'Сменить пароль' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Текущий пароль').fill('not my password');
  await dialog.getByLabel('Новый пароль', { exact: true }).fill('brand new password 1');
  await dialog.getByLabel('Новый пароль ещё раз').fill('brand new password 1');
  await dialog.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Текущий пароль не подошёл');

  await dialog.getByLabel('Текущий пароль').fill(E2E_SESSIONS_USER.password);
  await dialog.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(dialog).toBeHidden();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText(/пароль менялся/)).toBeVisible();

  // The other devices are signed out; this one stays.
  for (const other of [phone, second]) {
    await other.goto('/payouts');
    await expect(other).toHaveURL(/\/login/);
  }
  await page.goto('/payouts');
  await expect(page).toHaveURL(/\/payouts$/);
});
