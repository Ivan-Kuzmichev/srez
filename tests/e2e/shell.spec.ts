import { expect, test } from '@playwright/test';

test('wide layout: sidebar navigates and marks the current section', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Разделы' }).first();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Аналитика' }).click();
  await expect(page).toHaveURL(/\/analytics\/risk$/);
  await expect(nav.getByRole('link', { name: 'Аналитика' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Аналитика');
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
  for (const path of ['/', '/more', '/operations', '/settings']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, path).toBe(false);
  }
  const response = await page.goto('/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByText('Страница не найдена')).toBeVisible();
});

test('keyboard focus is visible', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'load' });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
});

test('pages carry the security headers and run under the strict CSP', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const response = await page.goto('/settings', { waitUntil: 'load' });
  const headers = response!.headers();
  expect(headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('same-origin');
  // Interactive after hydration: a select opens; no script or style was blocked.
  // While the page streams in, React keeps a hidden copy for a moment: take the first match.
  await page.getByLabel('Основная валюта').first().click();
  await expect(page.getByRole('option', { name: /Доллар/ })).toBeVisible();
  expect(violations).toEqual([]);
});
