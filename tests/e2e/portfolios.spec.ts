import { expect, test, type Page } from '@playwright/test';
import { E2E_PORTFOLIO_USER } from './users';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name=username]', E2E_PORTFOLIO_USER.username);
  await page.fill('input[name=password]', E2E_PORTFOLIO_USER.password);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/$/);
}

async function createPortfolio(page: Page, name: string, mode: 'По тегу' | 'Целиком') {
  await page.goto('/portfolios/new');
  await page.getByLabel('Название').fill(name);
  await page.getByLabel('Как входит счёт Брокерский').click();
  await page.getByRole('option', { name: mode }).click();
  if (mode === 'По тегу') {
    await page.getByLabel('Тег для счёта Брокерский').click();
    await page.getByRole('option', { name: 'пенсия' }).click();
  }
  await expect(page.getByTestId('portfolio-preview')).toContainText('Позиций');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page).toHaveURL(/\/portfolios\/[0-9a-f-]+$/);
}

test('a tag portfolio shows only its positions, a whole-account one shows all; deleting keeps operations', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(90_000);
  await signIn(page);
  // The worker recalculates positions on start; wait until they exist.
  await expect(async () => {
    await page.goto('/portfolios/new');
    await page.getByLabel('Как входит счёт Брокерский').click();
    await page.getByRole('option', { name: 'Целиком' }).click();
    await expect(page.getByTestId('portfolio-preview')).toContainText(/Позиций\s*2/);
  }).toPass({ timeout: 30_000 });

  await createPortfolio(page, 'Пенсия', 'По тегу');
  const tagPositions = page.getByTestId('positions');
  await expect(tagPositions).toContainText('SBER');
  await expect(tagPositions).not.toContainText('LKOH');
  await expect(tagPositions).not.toContainText('RUB');

  await createPortfolio(page, 'Всё', 'Целиком');
  const all = page.getByTestId('positions');
  await expect(all).toContainText('SBER');
  await expect(all).toContainText('LKOH');
  await expect(all).toContainText('RUB');

  // «Срез на дату»: a day before anything happened, then back to today.
  await page.getByRole('button', { name: 'Срез на дату' }).click();
  await page.getByLabel('Дата среза').fill('2001-01-01');
  await expect(page.getByTestId('snapshot-banner')).toContainText('Срез на конец дня 1 января 2001');
  await expect(page).toHaveURL(/date=2001-01-01/);
  await expect(page.getByText('В этот день в портфеле ещё ничего не было.')).toBeVisible();
  await page.getByRole('link', { name: 'Вернуться к сегодня' }).click();
  await expect(page.getByTestId('snapshot-banner')).toHaveCount(0);
  await expect(page.getByTestId('positions')).toContainText('LKOH');

  // «Карта портфеля»: a tile per position, the period switch recolors.
  const map = page.getByTestId('portfolio-map');
  await expect(map.getByRole('listitem', { name: /^LKOH/ })).toBeVisible();
  await map.getByRole('radio', { name: 'Всё' }).click();
  await expect(map).toContainText('с первой покупки');
  // Every tile inside the map, the thinnest too (padding once stretched them past its edge).
  const mapBox = (await map.getByRole('list').boundingBox())!;
  for (const r of await map.getByRole('listitem').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect),
  )) {
    expect(r.bottom).toBeLessThanOrEqual(mapBox.y + mapBox.height + 0.5);
    expect(r.right).toBeLessThanOrEqual(mapBox.x + mapBox.width + 0.5);
  }

  // «А если бы»: the same money on a deposit at its own rate.
  const whatIf = page.getByTestId('whatif');
  await whatIf.getByLabel('С чем сравнить').click();
  await page.getByRole('option', { name: 'Вклад под свой %' }).click();
  await whatIf.getByLabel('Ставка вклада, % годовых').fill('18');
  await whatIf.getByLabel('Ставка вклада, % годовых').press('Enter');
  await expect(page).toHaveURL(/whatif=deposit/);
  await expect(page).toHaveURL(/rate=18/);
  await expect(whatIf).toContainText('Было бы');
  await expect(whatIf).toContainText('На вкладе');
  // «⋯»: the deposit without capitalization.
  await whatIf.getByRole('button', { name: 'Настройки сравнения' }).click();
  await page.getByLabel('Проценты по вкладу — с капитализацией').uncheck();
  await expect(page).toHaveURL(/wc=0/);

  // Rebalance: a hint without targets; with them, classes, orders from held stocks and a saved plan.
  const whole = page.url().split('?')[0]!;
  await page.goto(`${whole}/rebalance`);
  await expect(page.getByText('У портфеля нет целей по классам')).toBeVisible();
  await page.goto(`${whole}/edit`);
  // Sector targets of their own: more than 100 % is refused, then a valid one is kept.
  const sectorTargets = page.getByTestId('sector-targets');
  await sectorTargets.getByLabel('Финансы, %').fill('80');
  await sectorTargets.getByLabel('Нефть и газ, %').fill('30');
  await expect(sectorTargets).toContainText('Задано 110 % из 100');
  await sectorTargets.getByLabel('Нефть и газ, %').fill('20');
  await page.getByLabel('Без целей, только учёт').uncheck();
  await page.getByLabel('Акции, %').fill('70');
  await page.getByLabel('Кэш, %').fill('30');
  await page.getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page).toHaveURL(/\/portfolios\/[0-9a-f-]+$/);
  // «Цели и ребаланс» by sectors: the targets set above, against what is held.
  const targetsCard = page.getByTestId('targets');
  await targetsCard.getByRole('radio', { name: 'Отрасли' }).click();
  await expect(targetsCard.getByTestId('targets-sectors')).toContainText('Финансы');
  await expect(targetsCard.getByTestId('targets-sectors')).toContainText('/ 80 %');
  await targetsCard.getByRole('radio', { name: 'Классы' }).click();
  await page.getByRole('link', { name: 'Рассчитать ребаланс' }).click();
  await page.getByLabel('Сколько вношу, ₽').fill('100000');
  await expect(page.getByTestId('rebalance-classes')).toContainText('Акции');
  // Sector targets set: the shares and funds go by sector; a sector with nothing held asks for a pick.
  await expect(page.getByTestId('rebalance-sectors')).toContainText('Финансы');
  await expect(page.getByTestId('rebalance-orders')).toContainText('выберите бумагу сами');
  // By class only: orders into the held stocks.
  await page.getByLabel('Акции и фонды — по целям отраслей').uncheck();
  await expect(page.getByTestId('rebalance-orders')).toContainText(/SBER|LKOH/);
  await page.getByRole('button', { name: 'Сохранить как план' }).click();
  await expect(page.getByText('План сохранён').first()).toBeVisible();

  await page.goto('/portfolios');
  await expect(page.getByTestId('portfolio-cards')).toContainText('Пенсия');
  await expect(page.getByTestId('accounts-table')).toContainText('Пенсия, тег «пенсия»');

  await page
    .getByTestId('portfolio-cards')
    .getByRole('link', { name: /Пенсия/ })
    .click();
  await page.getByRole('link', { name: 'Состав и цели' }).click();
  await page.getByRole('button', { name: 'Удалить портфель' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить портфель' }).click();
  await expect(page).toHaveURL(/\/portfolios$/);
  await expect(page.getByTestId('portfolio-cards')).not.toContainText('Пенсия');
  await page.goto('/operations?period=all');
  await expect(page.getByTestId('journal-table').locator('tbody tr')).toHaveCount(3);
});

test('the overview switches the display currency, and price settings persist', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await signIn(page);
  await expect(page.getByTestId('overview-value')).toContainText('₽');
  await page.getByRole('radio', { name: 'Доллары' }).click();
  await expect(page).toHaveURL(/cur=USD/);
  await expect(page.getByTestId('overview-value')).toContainText('$');

  await page.goto('/settings');
  await page.getByLabel('Ежедневный снимок стоимости').fill('22:30');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены').first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Ежедневный снимок стоимости')).toHaveValue('22:30');

  // «Расчёт доходности»: TWR as the primary figure shows on the portfolio cards; back to XIRR after.
  await page.getByLabel('TWR, без влияния пополнений').check();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('TWR, с начала').first()).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByLabel('TWR, без влияния пополнений')).toBeChecked();
  await page.getByLabel('XIRR, с учётом дат пополнений').check();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены').first()).toBeVisible();
});

test('risk shows the largest positions and the limits', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await signIn(page);
  await page.goto('/analytics');
  await expect(page).toHaveURL(/\/analytics\/risk$/);
  await expect(page.getByTestId('risk-cards')).toContainText('Максимальная просадка');
  await expect(page.getByTestId('risk-largest')).toContainText('LKOH');
  await expect(page.getByTestId('risk-currencies')).toContainText('Рубль');
  // «Состав»: the ring by assets, by classes, by sectors.
  // «Состав» under the largest positions: classes with their largest, then sectors.
  const composition = page.getByTestId('composition');
  await expect(composition).toContainText('Акции');
  await expect(composition).toContainText('крупнейшая LKOH');
  await composition.getByRole('radio', { name: 'Отрасли' }).click();
  await expect(composition).toContainText('акций и фондов на');
  const limits = page.getByTestId('risk-limits');
  await expect(limits).toContainText('Одна отрасль до 40 % акций и фондов');
  await expect(limits).toContainText('Одна акция до 8 %');
  await expect(limits).toContainText('Превышен');
  await limits.getByRole('link', { name: 'Изменить' }).click();
  await expect(page.getByTestId('settings-limits')).toBeVisible();
  await expect(page.getByLabel('Одна отрасль, до % акций и фондов')).toHaveValue('40');
});
