import { expect, test } from '@playwright/test';
import { E2E_PORTFOLIO_USER } from './users';

// NFR-8: the main round in Firefox, Safari and Safari on an iPhone. Reads only: the data belongs to
// scenarios that run in Chromium.
test.use({ storageState: { cookies: [], origins: [] } });

test('sign in, overview with its chart, journal, the operation form, analytics, settings', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    // WebKit reports link prefetches (?_rsc=) cut short by the next page.goto as «access control
    // checks»; Chromium and Firefox drop them quietly. Anything else counts.
    if (/_rsc=.* due to access control checks/.test(e.message)) return;
    errors.push(e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Content-Security-Policy/i.test(m.text()))
      errors.push(m.text());
  });

  await page.goto('/login');
  await page.fill('input[name=username]', E2E_PORTFOLIO_USER.username);
  await page.fill('input[name=password]', E2E_PORTFOLIO_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('overview-value')).toContainText('₽');

  await page.goto('/operations?period=all');
  await expect(page.getByTestId(isMobile ? 'journal-list' : 'journal-table').first()).toBeVisible();

  await page.goto('/operations/new');
  await page.getByLabel('Актив').fill('SBER');
  await expect(page.getByRole('option', { name: /SBER/ }).first()).toBeVisible();

  await page.goto('/settings');
  await page.getByLabel('Основная валюта').first().click();
  await expect(page.getByRole('option', { name: /Доллар/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Подключить' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/analytics/risk');
  await expect(page.getByTestId('risk-largest').first()).toContainText('LKOH');
  if (isMobile) {
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .last()
      .getByRole('link', { name: 'Выплаты' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Выплаты');
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
});
