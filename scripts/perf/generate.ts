/**
 * Load data for NFR-4: 20 000 operations over five years, daily prices and snapshots. Run on a fresh,
 * migrated database with the user already created:
 *   DATABASE_PATH=... pnpm exec tsx scripts/perf/generate.ts <username>
 * Deterministic: the same seed gives the same journal.
 */
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/db/client';
import { recalcAccount } from '../../src/db/mutations/positions';
import {
  finAccounts,
  fxRates,
  instruments,
  operations,
  portfolioRules,
  portfolios,
  portfolioTargets,
  prices,
  pricesLast,
  sources,
  user,
} from '../../src/db/schema';
import { updateSnapshots } from '../../src/jobs/market';

const OPS = 20_000;
const YEARS = 5;
const db = openDb(process.env.DATABASE_PATH!);
const owner = db
  .select()
  .from(user)
  .where(eq(user.username, process.argv[2] ?? 'owner'))
  .get();
if (!owner) throw new Error('Create the user first');

let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const DAY = 86_400_000;
const now = new Date();
const start = new Date(now.getTime() - YEARS * 365 * DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = Array.from({ length: YEARS * 365 + 1 }, (_, i) => iso(new Date(start.getTime() + i * DAY)));

// Instruments: 30 shares, 6 bonds, 2 funds, 2 coins; a random walk of daily closes for each.
type Inst = {
  id: string;
  kind: string;
  price: number;
  closes: Map<string, number>;
  currency: string;
  lot: number;
};
const insts: Inst[] = [];
const make = (kind: 'share' | 'bond' | 'etf' | 'crypto', i: number) => {
  const cls = { share: 'stocks', bond: 'bonds', etf: 'funds', crypto: 'crypto' }[kind] as 'stocks';
  const ticker = { share: `SH${i}`, bond: `OFZ${i}`, etf: `FND${i}`, crypto: i === 0 ? 'BTC' : 'ETH' }[kind];
  const currency = kind === 'crypto' ? 'USD' : 'RUB';
  const row = db
    .insert(instruments)
    .values({
      kind,
      assetClass: cls,
      ticker,
      name: `${ticker} нагрузочный`,
      currency,
      lot: '1',
      meta:
        kind === 'bond'
          ? { nominal: '1000', aci: '10', couponType: 'fixed', maturityDate: '2036-05-15', couponsPerYear: 2 }
          : kind === 'crypto'
            ? { coingeckoId: i === 0 ? 'bitcoin' : 'ethereum', yieldKind: 'none' }
            : { secid: ticker },
    })
    .returning()
    .get();
  let p = kind === 'bond' ? 950 : kind === 'crypto' ? (i === 0 ? 30000 : 2000) : 50 + rand() * 500;
  const closes = new Map<string, number>();
  for (const d of days) {
    p *= 1 + (rand() - 0.5) * (kind === 'bond' ? 0.004 : 0.04);
    closes.set(d, Math.round(p * 100) / 100);
  }
  insts.push({ id: row.id, kind, price: p, closes, currency, lot: 1 });
};
for (let i = 0; i < 30; i++) make('share', i);
for (let i = 0; i < 6; i++) make('bond', i);
for (let i = 0; i < 2; i++) make('etf', i);
for (let i = 0; i < 2; i++) make('crypto', i);
for (const inst of insts) {
  const rows = days.map((d) => ({
    instrumentId: inst.id,
    date: d,
    close: String(inst.closes.get(d)),
    currency: inst.currency,
    source: 'manual' as const,
  }));
  for (let k = 0; k < rows.length; k += 500)
    db.insert(prices)
      .values(rows.slice(k, k + 500))
      .run();
  db.insert(pricesLast)
    .values({
      instrumentId: inst.id,
      price: String(inst.closes.get(days.at(-1)!)),
      currency: inst.currency,
      at: now,
      source: 'manual',
    })
    .run();
}
let usd = 70;
const fx = days.map((d) => ({
  date: d,
  base: 'RUB',
  quote: 'USD',
  rate: String(Math.round((usd *= 1 + (rand() - 0.5) * 0.01) * 10000) / 10000),
  source: 'cbr' as const,
}));
for (let k = 0; k < fx.length; k += 500)
  db.insert(fxRates)
    .values(fx.slice(k, k + 500))
    .run();

// Three accounts; money comes in monthly, then buys, sells within holdings, dividends and coupons.
const source = db
  .insert(sources)
  .values({ userId: owner.id, kind: 'manual', name: 'Вручную' })
  .returning()
  .get();
const accounts = ['Брокерский', 'ИИС', 'Кошелёк'].map((name, i) =>
  db
    .insert(finAccounts)
    .values({
      userId: owner.id,
      sourceId: source.id,
      name,
      kind: i === 2 ? 'wallet' : i === 1 ? 'iis' : 'broker',
      currency: i === 2 ? 'USD' : 'RUB',
    })
    .returning()
    .get(),
);
const held = new Map<string, number>();
const cash = new Map<string, number>(accounts.map((a) => [a.id, 0]));
const rows: (typeof operations.$inferInsert)[] = [];
const base = (accountId: string, currency: string) => ({
  userId: owner.id,
  accountId,
  sourceId: source.id,
  origin: 'manual' as const,
  currency,
});
for (let n = 0; rows.length < OPS; n++) {
  // Steps that add nothing (a sale with nothing held) push n past OPS: the last day takes the rest.
  const dayIndex = Math.min(days.length - 2, Math.floor((n / (OPS * 1.3)) * (days.length - 2)) + 1);
  const day = days[dayIndex]!;
  const at = new Date(`${day}T${String(7 + (n % 10)).padStart(2, '0')}:00:00Z`);
  const crypto = rand() < 0.08;
  const account = crypto ? accounts[2]! : accounts[rand() < 0.6 ? 0 : 1]!;
  const ccy = crypto ? 'USD' : 'RUB';
  const pool = insts.filter((i) => (crypto ? i.kind === 'crypto' : i.kind !== 'crypto'));
  const inst = pool[Math.floor(rand() * pool.length)]!;
  const price = inst.closes.get(day)!;
  const key = `${account.id}|${inst.id}`;
  const r = rand();
  if (n % 25 === 0 || (cash.get(account.id) ?? 0) < price * 10) {
    const amount = crypto ? 2000 : 150_000;
    rows.push({ ...base(account.id, ccy), type: 'deposit', amount: String(amount), executedAt: at });
    cash.set(account.id, (cash.get(account.id) ?? 0) + amount);
  } else if (r < 0.55) {
    const qty = crypto ? Math.round((500 / price) * 1e6) / 1e6 : Math.max(1, Math.floor(20_000 / price));
    const sum = Math.round(qty * price * 100) / 100;
    rows.push({
      ...base(account.id, ccy),
      type: 'buy',
      instrumentId: inst.id,
      quantity: String(qty),
      price: String(price),
      fee: '1',
      amount: String(-(sum + 1)),
      executedAt: at,
    });
    held.set(key, (held.get(key) ?? 0) + qty);
    cash.set(account.id, (cash.get(account.id) ?? 0) - sum - 1);
  } else if (r < 0.8 && (held.get(key) ?? 0) > 0) {
    const have = held.get(key)!;
    const qty = crypto ? Math.round(have * 0.5 * 1e6) / 1e6 : Math.max(1, Math.floor(have / 2));
    if (qty <= 0 || qty > have) continue;
    const sum = Math.round(qty * price * 100) / 100;
    rows.push({
      ...base(account.id, ccy),
      type: 'sell',
      instrumentId: inst.id,
      quantity: String(qty),
      price: String(price),
      fee: '1',
      amount: String(sum - 1),
      executedAt: at,
    });
    held.set(key, have - qty);
    cash.set(account.id, (cash.get(account.id) ?? 0) + sum - 1);
  } else if (!crypto && (held.get(key) ?? 0) > 0) {
    const amount = Math.round(held.get(key)! * price * 0.02 * 100) / 100;
    rows.push({
      ...base(account.id, ccy),
      type: inst.kind === 'bond' ? 'coupon' : 'dividend',
      instrumentId: inst.id,
      amount: String(amount),
      tax: String(Math.round(amount * 0.13 * 100) / 100),
      executedAt: at,
    });
    cash.set(account.id, (cash.get(account.id) ?? 0) + amount);
  }
}
for (let k = 0; k < rows.length; k += 500)
  db.insert(operations)
    .values(rows.slice(k, k + 500))
    .run();

// Portfolios: everything with targets, and the IIS alone.
const all = db.insert(portfolios).values({ userId: owner.id, name: 'Всё' }).returning().get();
for (const a of accounts)
  db.insert(portfolioRules).values({ portfolioId: all.id, accountId: a.id, mode: 'all' }).run();
db.insert(portfolioTargets)
  .values([
    { portfolioId: all.id, assetClass: 'stocks', targetPct: '50' },
    { portfolioId: all.id, assetClass: 'bonds', targetPct: '25' },
    { portfolioId: all.id, assetClass: 'funds', targetPct: '10' },
    { portfolioId: all.id, assetClass: 'crypto', targetPct: '10' },
    { portfolioId: all.id, assetClass: 'cash', targetPct: '5' },
  ])
  .run();
const iis = db.insert(portfolios).values({ userId: owner.id, name: 'ИИС' }).returning().get();
db.insert(portfolioRules).values({ portfolioId: iis.id, accountId: accounts[1]!.id, mode: 'all' }).run();

let t = Date.now();
for (const a of accounts) recalcAccount(db, a.id, now);
console.log(`operations ${rows.length}, positions recalculated in ${Date.now() - t} ms`);
t = Date.now();
updateSnapshots(db, now, true);
console.log(`snapshots for ${YEARS} years in ${Date.now() - t} ms`);
db.$client.close();
