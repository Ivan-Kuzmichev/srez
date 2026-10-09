import { expect, test } from '@playwright/test';

test('issue an API token, call the API with it, see the call on the screen and in the logs', async ({
  page,
  request,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/settings/dev');
  const card = page.getByTestId('api-token-card');
  await card.getByRole('button', { name: /Выпустить токен|Перевыпустить/ }).click();
  const token = (await page.getByTestId('api-token-plain').textContent())!.trim();
  expect(token).toMatch(/^inv_[0-9A-Za-z]{43}$/);
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByTestId('api-token-masked')).toContainText(token.slice(-4));
  expect(await page.content()).not.toContain(token);

  const status = await request.get('/api/v1/sync/status', { headers: { authorization: `Bearer ${token}` } });
  expect(status.status()).toBe(200);
  const bad = await request.get('/api/v1/sync/status', {
    headers: { authorization: 'Bearer inv_0000000000000000000000000000000000000000000' },
  });
  expect(bad.status()).toBe(401);
  expect((await request.get('/api/v1/openapi.json')).status()).toBe(200);

  await page.reload();
  await expect(card).toContainText('/sync/status');

  // Log lines reach the database in batches: look again until the call is there.
  await expect(async () => {
    await page.goto('/settings/dev/logs');
    await page.locator('input[type=search]:visible').fill('sync/status');
    await expect(page.getByTestId('logs')).toContainText('GET /api/v1/sync/status 200', { timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.goto('/settings/dev');
  const [report] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Собрать отчёт о проблеме' }).click(),
  ]);
  expect(report.suggestedFilename()).toMatch(/^srez-report-.*\.json$/);

  await card.getByRole('button', { name: 'Отозвать' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отозвать' }).click();
  await expect(card).toContainText('Не выпущен');
  expect(
    (await request.get('/api/v1/sync/status', { headers: { authorization: `Bearer ${token}` } })).status(),
  ).toBe(401);
});
