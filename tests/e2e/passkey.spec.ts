import { expect, test } from '@playwright/test';
import { E2E_PASSKEY_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

test('add a passkey in settings, then sign in with it alone', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  // Chromium's virtual authenticator: a platform key with user verification, like Touch ID.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto('/login');
  await page.fill('input[name=username]', E2E_PASSKEY_USER.username);
  await page.fill('input[name=password]', E2E_PASSKEY_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'Добавить пасскей' }).click();
  await page.getByLabel('Название устройства').fill('Тестовый ключ');
  await page.getByRole('dialog').getByRole('button', { name: 'Добавить пасскей' }).click();
  await expect(page.getByTestId('passkeys')).toContainText('Тестовый ключ');
  await expect(page.getByTestId('passkeys')).toContainText('входов ещё не было');

  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: 'Войти с пасскеем' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings/security');
  await expect(page.getByTestId('passkeys')).toContainText('последний вход сегодня');

  await page.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByTestId('passkeys')).toHaveCount(0);
});
