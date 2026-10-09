import { describe, expect, it } from 'vitest';
import { finAccounts, instruments, operations, sources, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { realizedData } from './realized-data';

const now = new Date('2026-10-09T12:00:00Z');
const at = (s: string) => new Date(`${s}T10:00:00Z`);

function seeded() {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const source = db
    .insert(sources)
    .values({ userId: 'u1', kind: 'manual', name: 'Вручную' })
    .returning()
    .get();
  const account = db
    .insert(finAccounts)
    .values({ userId: 'u1', sourceId: source.id, name: 'Брокерский', kind: 'broker', currency: 'RUB' })
    .returning()
    .get();
  const sber = db
    .insert(instruments)
    .values({
      kind: 'share',
      assetClass: 'stocks',
      ticker: 'SBER',
      name: 'Сбербанк',
      currency: 'RUB',
      lot: '1',
    })
    .returning()
    .get();
  const base = {
    userId: 'u1',
    accountId: account.id,
    sourceId: source.id,
    origin: 'manual' as const,
    currency: 'RUB',
  };
  db.insert(operations)
    .values([
      { ...base, type: 'deposit', amount: '100000', executedAt: at('2022-01-10') },
      {
        ...base,
        type: 'buy',
        instrumentId: sber.id,
        quantity: '100',
        price: '200',
        fee: '10',
        amount: '-20010',
        executedAt: at('2022-06-01'),
      },
      {
        ...base,
        type: 'buy',
        instrumentId: sber.id,
        quantity: '50',
        price: '250',
        fee: '5',
        amount: '-12505',
        executedAt: at('2026-03-01'),
      },
      {
        ...base,
        type: 'sell',
        instrumentId: sber.id,
        quantity: '120',
        price: '300',
        fee: '18',
        amount: '35982',
        executedAt: at('2026-10-08'),
      },
      {
        ...base,
        type: 'dividend',
        instrumentId: sber.id,
        amount: '870',
        tax: '130',
        executedAt: at('2026-07-20'),
      },
      { ...base, type: 'fee', amount: '-99', executedAt: at('2026-02-01') },
      {
        ...base,
        type: 'sell',
        instrumentId: sber.id,
        quantity: '10',
        price: '260',
        amount: '2600',
        executedAt: at('2025-12-01'),
      },
    ])
    .run();
  return db;
}

describe('the year’s profit', () => {
  it('FIFO splits the sale by holding; fees and the withheld tax stand apart', () => {
    const r = realizedData(seeded(), 'u1', null, 'Europe/Moscow', '2026', 'fifo', now);
    expect(r.years).toEqual(['2025', '2026']);
    // The 2025 sale took 10 of the old lot: 90 old and 30 new are left for 2026, FIFO takes 90 + 30.
    expect(
      r.rows.map((x) => [
        x.group,
        x.quantity.toFixed(),
        x.buyPrice.toFixed(),
        x.sellPrice.toFixed(),
        x.pnl.toFixed(),
      ]),
    ).toEqual([
      ['over3', '90', '200', '300', '9000'],
      ['under1', '30', '250', '300', '1500'],
    ]);
    const s = r.summary;
    expect([s.sales, s.payouts, s.fees, s.taxes, s.total].map((v) => v.toFixed())).toEqual([
      '10500',
      '1000',
      '122',
      '130',
      '11248',
    ]);
    expect(r.rows[0]).toMatchObject({ ticker: 'SBER', accountName: 'Брокерский' });
  });

  it('the average method costs the sale at the average price', () => {
    const r = realizedData(seeded(), 'u1', null, 'Europe/Moscow', '2026', 'average', now);
    // Before the 2026 sale: 140 units, 90 × 200 + 50 × 250 = 30 500 → 217.857…; 120 units cost 26 142.86.
    expect(r.summary.sales.toFixed(2)).toBe('9857.14');
    expect(r.rows.every((x) => x.buyPrice.toFixed(2) === '217.86')).toBe(true);
  });
});
