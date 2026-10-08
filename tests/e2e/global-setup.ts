import { chromium, type FullConfig } from '@playwright/test';
import { E2E_USER } from './users';

/** Signs in once and saves the cookies; every test starts signed in unless it opts out. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.fill('input[name=username]', E2E_USER.username);
  await page.fill('input[name=password]', E2E_USER.password);
  await page.click('button[type=submit]');
  await page.waitForURL(`${baseURL}/`);
  await page.context().storageState({ path: 'test-results/.auth/owner.json' });
  await browser.close();
}
