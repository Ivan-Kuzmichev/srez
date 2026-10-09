import { expect, test, type Page } from '@playwright/test';
import { E2E_ANALYTICS_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name=username]', E2E_ANALYTICS_USER.username);
  await page.fill('input[name=password]', E2E_ANALYTICS_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
}

test('bonds: yield, the issue table, redemptions and the rate scenario', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await signIn(page);
  // The worker recalculates positions on start; wait until the bond is held.
  await expect(async () => {
    await page.goto('/analytics/bonds');
    await expect(page.getByTestId('bonds-issues')).toContainText('ОФЗ 26238', { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('bonds-cards')).toContainText('Доходность к погашению');
  await expect(page.getByTestId('bonds-cards')).toContainText('%');
  const issues = page.getByTestId('bonds-issues');
  await expect(issues).toContainText('7,08 %');
  await expect(issues).toContainText('май 2041');
  await expect(page.getByTestId('bonds-redemptions')).toContainText('2041');
  await expect(page.getByTestId('bonds-redemptions')).toContainText('10 000 ₽');
  await expect(page.getByTestId('bonds-rates')).toContainText('Рост на 1 п.п.');
  await expect(page.getByTestId('bonds-rates')).toContainText('Фиксированный, 100,0 %');
});
