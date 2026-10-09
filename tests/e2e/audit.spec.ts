import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ANALYTICS_USER } from './users';

// NFR-7, phase 10: every screen at 390, 768, 1024 and 1440 — no sideways scroll, no WCAG 2.1 AA
// findings from axe; the keyboard reaches controls and always shows where it is.
test.use({ storageState: { cookies: [], origins: [] } });

const WIDTHS = [390, 768, 1024, 1440];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name=username]', E2E_ANALYTICS_USER.username);
  await page.fill('input[name=password]', E2E_ANALYTICS_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
}

async function routes(page: Page): Promise<string[]> {
  await page.goto('/portfolios');
  const portfolio = await page
    .getByTestId('portfolio-cards')
    .getByRole('link')
    .first()
    .getAttribute('href', { timeout: 15_000 });
  // The worker recalculates positions on start: wait until the portfolio shows a security.
  const asset = page.getByTestId('positions').locator('a[href^="/assets/"]').first();
  await expect(async () => {
    await page.goto(`${portfolio}`);
    await expect(asset).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const assetHref = await asset.getAttribute('href', { timeout: 5000 });
  return [
    '/',
    '/portfolios',
    `${portfolio}`,
    `${portfolio}/rebalance`,
    `${portfolio}/edit`,
    '/portfolios/new',
    '/operations?period=all',
    '/operations/new',
    '/payouts',
    `${assetHref}`,
    '/analytics/risk',
    '/analytics/bonds',
    '/analytics/realized',
    '/sources',
    '/sources/wallets/new',
    '/settings',
    '/settings/security',
    '/settings/crypto',
    '/settings/dev',
    '/settings/dev/logs',
    '/more',
  ];
}

async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  // Client components settle (charts measure, selects mount); logs keep polling, so no «networkidle».
  await page.waitForTimeout(150);
}

for (const width of WIDTHS)
  test(`screens at ${width}: no sideways scroll, no accessibility findings`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop');
    test.setTimeout(240_000);
    const page = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    await signIn(page);
    const list = await routes(page);
    await page.setViewportSize({ width, height: 900 });
    const problems: string[] = [];
    for (const path of list) {
      await visit(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) problems.push(`${path}: +${over}px sideways`);
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      for (const v of axe.violations) problems.push(`${path}: ${v.id} ×${v.nodes.length}`);
    }
    expect(problems).toEqual([]);
  });

for (const width of [1440, 390])
  test(`the keyboard always shows where it is at ${width}`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop');
    test.setTimeout(240_000);
    const page = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    await signIn(page);
    const list = await routes(page);
    await page.setViewportSize({ width, height: 900 });
    const unseen = new Set<string>();
    for (const path of list) {
      await visit(page, path);
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const bad = await page.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const s = getComputedStyle(e);
          const ring =
            (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
          return ring
            ? null
            : `${e.tagName}[${e.getAttribute('type') ?? ''}] ${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30) ?? ''}`;
        });
        if (bad) unseen.add(`${path}: ${bad}`);
      }
    }
    expect([...unseen]).toEqual([]);
  });

test('sign-in and the 404 page pass the same checks', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop');
  const page = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
  const problems: string[] = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/login', '/no-such-page']) {
      await visit(page, path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) problems.push(`${width} ${path}: +${over}px sideways`);
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      for (const v of axe.violations) problems.push(`${width} ${path}: ${v.id}`);
    }
  }
  expect(problems).toEqual([]);
});
