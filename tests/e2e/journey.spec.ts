import { expect, test, type Page } from '@playwright/test';
import { E2E_JOURNEY_USER, E2E_PORTFOLIO_USER } from './users';

// Phase 10: the main paths end to end — a newcomer on a wide screen, and the daily round on a phone.
test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, user: { username: string; password: string }) {
  await page.goto('/login');
  await page.fill('input[name=username]', user.username);
  await page.fill('input[name=password]', user.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
}

test('a newcomer: empty overview → account → money and a purchase → portfolio with targets → rebalance and analytics', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(150_000);
  await signIn(page, E2E_JOURNEY_USER);
  await expect(page.getByRole('heading', { name: 'Данных пока нет' })).toBeVisible();

  await page.goto('/sources');
  await page.getByRole('button', { name: 'Добавить счёт' }).click();
  await page.getByRole('dialog').getByLabel('Название').fill('Брокерский');
  await page.getByRole('dialog').getByRole('button', { name: 'Добавить счёт' }).click();
  await expect(page.getByTestId('manual-accounts')).toContainText('Брокерский');

  await page.goto('/operations/new');
  await page.getByRole('radio', { name: 'Пополнение или вывод' }).check();
  await page.getByLabel('Сумма', { exact: true }).fill('100000');
  await page.getByRole('button', { name: 'Сохранить и добавить ещё' }).click();
  await expect(page.getByText('Сохранено. Вносите следующую').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Покупка' }).check();
  await page.getByLabel('Актив').fill('SBER');
  await page.getByRole('option', { name: /SBER/ }).first().click();
  await page.getByLabel('Количество').fill('100');
  await page.getByLabel('Цена за единицу').fill('300');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(/\/operations/);

  // The worker recalculates positions; then a whole-account portfolio with targets.
  await expect(async () => {
    await page.goto('/portfolios/new');
    await page.getByLabel('Как входит счёт Брокерский').click();
    await page.getByRole('option', { name: 'Целиком' }).click();
    await expect(page.getByTestId('portfolio-preview')).toContainText(/Позиций\s*1/, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.getByLabel('Название').fill('Основной');
  await page.getByLabel('Без целей, только учёт').uncheck();
  await page.getByLabel('Акции, %').fill('60');
  await page.getByLabel('Кэш, %').fill('40');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page).toHaveURL(/\/portfolios\/[0-9a-f-]+$/);
  await expect(page.getByTestId('positions')).toContainText('SBER');

  await page.getByRole('link', { name: 'Рассчитать ребаланс' }).click();
  await page.getByLabel('Сколько вношу, ₽').fill('50000');
  await expect(page.getByTestId('rebalance-classes')).toContainText('Акции');

  await page.goto('/');
  await expect(page.getByTestId('overview-value')).toContainText('₽');
  await page.goto('/analytics/risk');
  await expect(page.getByTestId('risk-largest')).toContainText('SBER');
  await page.goto('/payouts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Выплаты');
});

test('the phone round: overview, journal, a new operation, portfolios, payouts, settings', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone');
  await signIn(page, E2E_PORTFOLIO_USER);
  await expect(page.getByTestId('overview-value')).toBeVisible();
  const bar = page.getByRole('navigation', { name: 'Разделы' }).last();

  await bar.getByRole('link', { name: 'Операции' }).click();
  await expect(page).toHaveURL(/\/operations/);
  await expect(page.getByTestId('journal-list')).toBeVisible();
  await page.getByRole('link', { name: 'Добавить операцию' }).click();
  await expect(page.getByLabel('Актив')).toBeVisible();
  // The form takes the whole phone screen: back to the journal, where the bar is.
  await page.goBack();

  await bar.getByRole('link', { name: 'Портфели' }).click();
  await expect(page).toHaveURL(/\/portfolios$/);
  await bar.getByRole('link', { name: 'Выплаты' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Выплаты');

  await bar.getByRole('link', { name: 'Ещё' }).click();
  await page.getByRole('link', { name: 'Общие' }).click();
  await expect(page.getByTestId('settings-returns').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBe(0);
});
