// Seeds the e2e database before the server starts, so tests need no network:
// a share in the directory, and for the portfolio user an account with tagged positions, prices and a rate.
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/db/client';
import {
  finAccounts,
  fxRates,
  instruments,
  operations,
  payoutEvents,
  portfolioRules,
  portfolios,
  portfolioTargets,
  pricesLast,
  sources,
  tags,
  user,
} from '../../src/db/schema';
import { E2E_ANALYTICS_USER, E2E_PORTFOLIO_USER } from './users';

const db = openDb(process.env.DATABASE_PATH ?? './data/e2e.db');
const share = (ticker: string, name: string, isin: string) =>
  db
    .insert(instruments)
    .values({ kind: 'share', assetClass: 'stocks', ticker, name, isin, currency: 'RUB', lot: '1' })
    .onConflictDoNothing()
    .returning()
    .get() ?? db.select().from(instruments).where(eq(instruments.isin, isin)).get()!;
const sber = share('SBER', 'Сбербанк', 'RU0009029540');
const lkoh = share('LKOH', 'Лукойл', 'RU0009024277');

const owner = db.select().from(user).where(eq(user.username, E2E_PORTFOLIO_USER.username)).get();
if (owner) {
  const source = db
    .insert(sources)
    .values({ userId: owner.id, kind: 'manual', name: 'Вручную' })
    .returning()
    .get();
  const main = db.insert(tags).values({ userId: owner.id, name: 'основной' }).returning().get();
  const pension = db.insert(tags).values({ userId: owner.id, name: 'пенсия' }).returning().get();
  const account = db
    .insert(finAccounts)
    .values({
      userId: owner.id,
      sourceId: source.id,
      name: 'Брокерский',
      kind: 'broker',
      currency: 'RUB',
      defaultTagId: main.id,
    })
    .returning()
    .get();
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
  const base = {
    userId: owner.id,
    accountId: account.id,
    sourceId: source.id,
    origin: 'manual' as const,
    currency: 'RUB',
  };
  db.insert(operations)
    .values([
      { ...base, type: 'deposit', amount: '500000', executedAt: at(40) },
      {
        ...base,
        type: 'buy',
        instrumentId: sber.id,
        tagId: pension.id,
        quantity: '100',
        price: '300',
        amount: '-30000',
        executedAt: at(30),
      },
      {
        ...base,
        type: 'buy',
        instrumentId: lkoh.id,
        quantity: '10',
        price: '7000',
        amount: '-70000',
        executedAt: at(20),
      },
    ])
    .run();
  const now = new Date();
  for (const [id, price] of [
    [sber.id, '310'],
    [lkoh.id, '7100'],
  ] as const) {
    db.insert(pricesLast)
      .values({ instrumentId: id, price, currency: 'RUB', at: now, source: 'manual' })
      .onConflictDoNothing()
      .run();
  }
  const today = now.toISOString().slice(0, 10);
  db.insert(fxRates)
    .values({ date: today, base: 'RUB', quote: 'USD', rate: '90', source: 'cbr' })
    .onConflictDoNothing()
    .run();
}

// The analytics user: a share sold in two holding periods, a dividend with tax, a bond with its schedule.
const analyst = db.select().from(user).where(eq(user.username, E2E_ANALYTICS_USER.username)).get();
if (analyst) {
  const source = db
    .insert(sources)
    .values({ userId: analyst.id, kind: 'manual', name: 'Вручную' })
    .returning()
    .get();
  const account = db
    .insert(finAccounts)
    .values({ userId: analyst.id, sourceId: source.id, name: 'Брокерский', kind: 'broker', currency: 'RUB' })
    .returning()
    .get();
  const ofz = db
    .insert(instruments)
    .values({
      kind: 'bond',
      assetClass: 'bonds',
      ticker: 'SU26238RMFS4',
      name: 'ОФЗ 26238',
      isin: 'RU000A1038V6',
      currency: 'RUB',
      lot: '1',
      meta: {
        nominal: '1000',
        aci: '10',
        couponType: 'fixed',
        maturityDate: '2041-05-15',
        couponsPerYear: 2,
        amortization: false,
      },
    })
    .returning()
    .get();
  const day = 86_400_000;
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day);
  const base = {
    userId: analyst.id,
    accountId: account.id,
    sourceId: source.id,
    origin: 'manual' as const,
    currency: 'RUB',
  };
  db.insert(operations)
    .values([
      { ...base, type: 'deposit', amount: '1000000', executedAt: at(1500) },
      {
        ...base,
        type: 'buy',
        instrumentId: sber.id,
        quantity: '100',
        price: '200',
        fee: '10',
        amount: '-20010',
        executedAt: at(1400),
      },
      {
        ...base,
        type: 'buy',
        instrumentId: sber.id,
        quantity: '50',
        price: '250',
        fee: '5',
        amount: '-12505',
        executedAt: at(200),
      },
      {
        ...base,
        type: 'buy',
        instrumentId: ofz.id,
        quantity: '10',
        price: '650',
        accruedInterest: '5',
        amount: '-6550',
        executedAt: at(100),
      },
      // FIFO: 100 from the old lot (over three years), 20 from the new one (under a year).
      {
        ...base,
        type: 'sell',
        instrumentId: sber.id,
        quantity: '120',
        price: '300',
        fee: '18',
        amount: '35982',
        executedAt: at(1),
      },
      { ...base, type: 'dividend', instrumentId: sber.id, amount: '870', tax: '130', executedAt: at(1) },
    ])
    .run();
  db.insert(pricesLast)
    .values({ instrumentId: ofz.id, price: '634', currency: 'RUB', at: new Date(), source: 'manual' })
    .onConflictDoNothing()
    .run();
  const next = new Date(Date.now() + 30 * day);
  for (let d = next; d.toISOString().slice(0, 10) < '2041-05-15'; d = new Date(d.getTime() + 182 * day))
    db.insert(payoutEvents)
      .values({
        instrumentId: ofz.id,
        kind: 'coupon',
        payDate: d.toISOString().slice(0, 10),
        amountPerUnit: '35.4',
        currency: 'RUB',
        source: 'manual',
      })
      .run();
  // A portfolio with targets, so every screen (portfolio, rebalance, asset) has something to show.
  const whole = db.insert(portfolios).values({ userId: analyst.id, name: 'Основной' }).returning().get();
  db.insert(portfolioRules).values({ portfolioId: whole.id, accountId: account.id, mode: 'all' }).run();
  db.insert(portfolioTargets)
    .values([
      { portfolioId: whole.id, assetClass: 'stocks', targetPct: '50' },
      { portfolioId: whole.id, assetClass: 'bonds', targetPct: '30' },
      { portfolioId: whole.id, assetClass: 'cash', targetPct: '20' },
    ])
    .run();
  db.insert(payoutEvents)
    .values({
      instrumentId: ofz.id,
      kind: 'redemption',
      payDate: '2041-05-15',
      amountPerUnit: '1000',
      currency: 'RUB',
      source: 'manual',
    })
    .run();
}
db.$client.close();
