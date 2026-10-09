import { chromium } from '@playwright/test';
const [, , base, P, A] = process.argv;
const routes = ['/', '/portfolios', `/portfolios/${P}`, `/portfolios/${P}/rebalance`, '/operations', '/operations/new', '/payouts', `/assets/${A}`, '/analytics/risk', '/analytics/realized', '/sources', '/sources/wallets/new', '/settings', '/settings/security', '/settings/crypto', '/settings/dev'];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(base + '/login'); await page.waitForLoadState('networkidle');
await page.fill('input[name=username]', 'owner'); await page.fill('input[name=password]', 'owner password 123');
await page.click('button[type=submit]'); await page.waitForURL(base + '/');
const bad = new Map();
for (const w of [1440, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const r of routes) {
    await page.goto(base + r); await page.waitForLoadState('networkidle');
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return null;
        const s = getComputedStyle(e);
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
        return visible ? null : `${e.tagName}[${e.getAttribute('type')}] ${e.labels?.[0]?.textContent ?? ''} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('name') ?? ''}`;
      });
      if (info && !bad.has(info)) bad.set(info, `${w} ${r}`);
    }
  }
}
for (const [k, v] of bad) console.log(v, k);
await browser.close();
