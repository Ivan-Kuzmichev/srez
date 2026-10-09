// Server time to open each screen (NFR-4): signs in, then loads every route three times: the first
// load (cold, right after a journal change) and the median of the rest.
import { chromium } from '@playwright/test';
const [, , base, user, password] = process.argv;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.setDefaultTimeout(120000);
await page.goto(base + '/login');
await page.fill('input[name=username]', user);
await page.fill('input[name=password]', password);
await page.click('button[type=submit]');
await page.waitForURL(base + '/');
await page.goto(base + '/portfolios');
const portfolio = await page.locator('[data-testid=portfolio-cards] a').first().getAttribute('href');
await page.goto(base + portfolio);
const asset = await page.locator('[data-testid=positions] a[href^="/assets/"]').first().getAttribute('href');
const routes = [
  '/',
  '/portfolios',
  portfolio,
  `${portfolio}/rebalance`,
  '/operations',
  '/operations?period=all',
  '/payouts',
  asset,
  '/analytics/risk',
  '/analytics/bonds',
  '/analytics/realized',
  '/sources',
  '/settings',
];
const rows = [];
for (const r of routes) {
  const times = [];
  for (let i = 0; i < 3; i++) {
    const res = await page.goto(base + r, { waitUntil: 'domcontentloaded' });
    const t = await res.request().timing();
    times.push(Math.round(t.responseEnd));
  }
  const cold = times[0];
  const warm = times.slice(1).sort((a, b) => a - b)[0];
  rows.push([r.replace(/[0-9a-f-]{36}/g, ':id'), cold, warm]);
}
console.log('  cold   warm');
for (const [r, cold, warm] of rows)
  console.log(`${String(cold).padStart(6)} ${String(warm).padStart(6)}  ${r}`);
await browser.close();
