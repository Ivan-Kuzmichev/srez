import { expect, test } from '@playwright/test';
import { totpFromUri } from '../helpers/totp';
import { E2E_TOTP_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

test('enable 2FA in settings, then sign in with a code', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const signInWithPassword = async () => {
    await page.goto('/login');
    await page.fill('input[name=username]', E2E_TOTP_USER.username);
    await page.fill('input[name=password]', E2E_TOTP_USER.password);
    await page.click('button[type=submit]');
  };

  await signInWithPassword();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/settings/security');
  await expect(page.getByText('Не включена')).toBeVisible();

  await page.getByLabel('Подтвердите паролем').fill(E2E_TOTP_USER.password);
  await page.getByRole('button', { name: 'Настроить' }).click();
  await expect(page.getByRole('img', { name: 'QR-код для приложения-аутентификатора' })).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())!.replace(/\s/g, '');
  const uri = `otpauth://totp/test?secret=${secret}`;

  await page.getByLabel('Код из приложения').fill('123456' === totpFromUri(uri) ? '654321' : '123456');
  await page.getByRole('button', { name: 'Включить' }).click();
  await expect(page.getByText('Код не подошёл')).toBeVisible();

  await page.getByLabel('Код из приложения').fill(totpFromUri(uri));
  await page.getByRole('button', { name: 'Включить' }).click();
  const codes = page.getByTestId('backup-codes').locator('span');
  await expect(codes).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Готово' })).toBeDisabled();
  await page.getByLabel('Коды сохранены в надёжном месте').check();
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText('Осталось 10 из 10')).toBeVisible();

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await signInWithPassword();
  await expect(page).toHaveURL(/\/login\/2fa/);
  await expect(page.getByRole('heading', { name: 'Код подтверждения' })).toBeVisible();
  // The next period's code: the current one was just spent on enabling, and ±1 step is accepted.
  await page.getByLabel('Код из приложения').fill(totpFromUri(uri, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
