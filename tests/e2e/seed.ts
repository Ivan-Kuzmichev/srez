// Seeds the e2e database before the server starts, so tests need no network:
// a share in the directory, and for the portfolio user an account with tagged positions, prices and a rate.
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/db/client';
import {
  finAccounts,
  fxRates,
  instruments,
  operations,
  pricesLast,
  sources,
  tags,
  user,
} from '../../src/db/schema';
import { E2E_PORTFOLIO_USER } from './users';

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
db.$client.close();
