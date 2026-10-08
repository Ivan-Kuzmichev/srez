import { expect, test } from '@playwright/test';

test('wide layout: sidebar navigates and marks the current section', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Разделы' }).first();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Аналитика' }).click();
  await expect(page).toHaveURL(/\/analytics\/risk$/);
  await expect(nav.getByRole('link', { name: 'Аналитика' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Риск');
});

test('phone layout: bottom bar leads to «Ещё» and on to settings', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Разделы' }).last();
  await expect(bar).toBeVisible();
  await bar.getByRole('link', { name: 'Ещё' }).click();
  await expect(page).toHaveURL(/\/more$/);
  await page.getByRole('link', { name: 'Логи' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Логи');
  await expect(bar.getByRole('link', { name: 'Ещё' })).toHaveAttribute('aria-current', 'page');
});

test('no horizontal scroll and a 404 page', async ({ page }) => {
  for (const path of ['/', '/more', '/operations', '/dev/ui']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, path).toBe(false);
  }
  const response = await page.goto('/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByText('Страница не найдена')).toBeVisible();
});

test('keyboard focus is visible', async ({ page }) => {
  await page.goto('/dev/ui', { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
});
