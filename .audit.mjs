import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
const [, , base, P, A, O] = process.argv;
const routes = ['/', '/portfolios', `/portfolios/${P}`, `/portfolios/${P}/rebalance`, `/portfolios/${P}/edit`, '/portfolios/new', '/operations', '/operations?period=all', '/operations/new', `/operations/${O}/edit`, '/payouts', `/assets/${A}`, '/analytics/risk', '/analytics/bonds', '/analytics/realized', '/sources', '/sources/wallets/new', '/settings', '/settings/security', '/settings/crypto', '/settings/dev', '/settings/dev/logs', '/more', '/onboarding'];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.setDefaultTimeout(60000);
await page.goto(base + '/login'); await page.waitForLoadState('networkidle');
await page.fill('input[name=username]', 'owner'); await page.fill('input[name=password]', 'owner password 123');
await page.click('button[type=submit]'); await page.waitForURL(base + '/');
for (const w of [390, 768, 1024, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const r of routes) {
    await page.goto(base + r); await page.waitForLoadState('networkidle');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) console.log(`OVERFLOW ${w} ${r} +${over}px`);
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of res.violations) console.log(`AXE ${w} ${r} ${v.id} x${v.nodes.length}`);
  }
}
await browser.close();
