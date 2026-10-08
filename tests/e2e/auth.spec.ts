import { expect, test } from '@playwright/test';
import { E2E_LOCKOUT_USER, E2E_USER } from './users';

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('any app route leads to the sign-in page and back after signing in', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.goto('/operations');
    await expect(page).toHaveURL(/\/login\?next=%2Foperations$/);
    await page.fill('input[name=username]', E2E_USER.username);
    await page.fill('input[name=password]', E2E_USER.password);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/operations$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Операции');
  });

  test('a wrong password says so without details and keeps the username', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone');
    await page.goto('/login');
    await page.fill('input[name=username]', E2E_USER.username);
    await page.fill('input[name=password]', 'not the password');
    await page.click('button[type=submit]');
    await expect(page.locator('main [role=alert]')).toContainText('Неверный логин или пароль.');
    await expect(page.locator('input[name=username]')).toHaveValue(E2E_USER.username);
  });

  test('the fifth failure locks password sign-in with a timer', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.goto('/login');
    await page.fill('input[name=username]', E2E_LOCKOUT_USER.username);
    for (let i = 5; i >= 1; i--) {
      await page.fill('input[name=password]', 'not the password');
      await page.click('button[type=submit]');
      if (i > 1) await expect(page.locator('main [role=alert]')).toContainText(`Осталось ${i - 1}`);
    }
    await expect(page.getByRole('heading', { name: 'Вход по паролю закрыт' })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveText(/^1[45]:\d\d$/);
  });
});

test('sign out ends the session', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  // A separate session, so the shared saved one stays valid for other tests.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name=username]', E2E_USER.username);
  await page.fill('input[name=password]', E2E_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/payouts');
  await expect(page).toHaveURL(/\/login/);
});
