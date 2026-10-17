import { describe, expect, it } from 'vitest';
import { recalcAccount } from '@/db/mutations/positions';
import { prices, pricesLast } from '@/db/schema';
import { insertOperation, seedAccount, seedShare } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { mapTiles } from './map-data';
import { loadFx, loadValuedCells } from './portfolio-data';

const tz = 'Europe/Moscow';
const now = new Date('2026-10-18T12:00:00Z');

describe('«Карта портфеля»', () => {
  it('a tile per instrument by share; the price change over each period, none past the history', () => {
    const db = createTestDb();
    seedAccount(db);
    seedShare(db, 'sber', 'SBER');
    seedShare(db, 'lkoh', 'LKOH');
    const at = (d: string) => new Date(`${d}T09:00:00Z`);
    insertOperation(db, { type: 'deposit', amount: '100000', executedAt: at('2026-01-10') });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'sber',
      quantity: '100',
      price: '250',
      amount: '-25000',
      executedAt: at('2026-01-12'),
    });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'lkoh',
      quantity: '10',
      price: '7000',
      amount: '-70000',
      executedAt: at('2026-09-20'),
    });
    recalcAccount(db, 'a1');
    db.insert(prices)
      .values([
        { instrumentId: 'sber', date: '2026-01-12', close: '250', currency: 'RUB', source: 'moex' },
        { instrumentId: 'sber', date: '2026-09-18', close: '280', currency: 'RUB', source: 'moex' },
        { instrumentId: 'sber', date: '2026-10-17', close: '294', currency: 'RUB', source: 'moex' },
        { instrumentId: 'sber', date: '2026-10-18', close: '300', currency: 'RUB', source: 'moex' },
        { instrumentId: 'lkoh', date: '2026-09-20', close: '7000', currency: 'RUB', source: 'moex' },
        { instrumentId: 'lkoh', date: '2026-10-18', close: '6650', currency: 'RUB', source: 'moex' },
      ])
      .run();
    db.insert(pricesLast)
      .values([
        { instrumentId: 'sber', price: '300', currency: 'RUB', at: now, source: 'moex' },
        { instrumentId: 'lkoh', price: '6650', currency: 'RUB', at: now, source: 'moex' },
      ])
      .run();
    const fx = loadFx(db);
    const tiles = mapTiles(db, 'u1', loadValuedCells(db, 'u1', fx), fx, tz, now);
    // LKOH 66 500, SBER 30 000, rubles 5 000.
    expect(tiles.map((t) => [t.ticker, t.share.toFixed(1)])).toEqual([
      ['LKOH', '65.5'],
      ['SBER', '29.6'],
      ['RUB', '4.9'],
    ]);
    const change = (ticker: string, p: keyof (typeof tiles)[number]['changes']) =>
      tiles.find((t) => t.ticker === ticker)!.changes[p]?.toFixed(2) ?? null;
    expect([change('SBER', '1d'), change('SBER', '1m'), change('SBER', 'all')]).toEqual([
      '2.04',
      '7.14',
      '20.00',
    ]);
    // LKOH has no close a year back: no change rather than a wrong one; since its first purchase −5 %.
    expect([change('LKOH', '1y'), change('LKOH', 'all')]).toEqual([null, '-5.00']);
    expect(change('RUB', '1m')).toBe('0.00');
  });
});
