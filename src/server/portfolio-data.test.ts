import { describe, expect, it } from 'vitest';
import { deletePortfolio, savePortfolio } from '@/db/mutations/portfolios';
import { recalcAccount } from '@/db/mutations/positions';
import { finAccounts, operations, prices, pricesLast, tags } from '@/db/schema';
import { rebuildAccountSnapshots } from '@/db/mutations/snapshots';
import { insertOperation, seedAccount, seedShare } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import {
  convertSeries,
  endOfLocalDay,
  everything,
  firstSnapshotDate,
  ledgerUntil,
  loadValuedCellsAt,
  listPortfolios,
  loadFx,
  loadUserLedger,
  loadValuedCells,
  portfolioScope,
  summarizeArea,
} from './portfolio-data';

const tz = 'Europe/Moscow';

function setup() {
  const db = createTestDb();
  seedAccount(db);
  seedShare(db, 'sber', 'SBER');
  seedShare(db, 'lkoh', 'LKOH');
  db.insert(tags)
    .values([
      { id: 'pension', userId: 'u1', name: 'пенсия' },
      { id: 'main', userId: 'u1', name: 'основной' },
    ])
    .run();
  db.update(finAccounts).set({ defaultTagId: 'main' }).run();
  insertOperation(db, { type: 'deposit', amount: '100000' });
  insertOperation(db, {
    type: 'buy',
    instrumentId: 'sber',
    tagId: 'pension',
    quantity: '100',
    price: '300',
    amount: '-30000',
  });
  insertOperation(db, { type: 'buy', instrumentId: 'lkoh', quantity: '2', price: '7000', amount: '-14000' });
  recalcAccount(db, 'a1');
  const now = new Date();
  db.insert(pricesLast)
    .values([
      { instrumentId: 'sber', price: '310', currency: 'RUB', at: now, source: 'moex' },
      { instrumentId: 'lkoh', price: '7100', currency: 'RUB', at: now, source: 'moex' },
    ])
    .run();
  return db;
}

const area = (db: ReturnType<typeof setup>, scope: Parameters<typeof summarizeArea>[2]) => {
  const fx = loadFx(db);
  return summarizeArea(
    db,
    'u1',
    scope,
    loadValuedCells(db, 'u1', fx),
    loadUserLedger(db, 'u1'),
    fx,
    tz,
    null,
  );
};

describe('areas', () => {
  it('the whole account: every cell, invested is the deposit', () => {
    const s = area(db0(), everything);
    expect(s.value.toFixed()).toBe('101200'); // 56 000 cash + 31 000 SBER + 14 200 LKOH
    expect(s.invested.toFixed()).toBe('100000');
    expect(s.profit.toFixed()).toBe('1200');
  });

  it('a tag portfolio sees only its positions; buying with outside cash is what was invested', () => {
    const db = setup();
    const id = savePortfolio(db, 'u1', {
      name: 'Долгосрочный',
      rules: [{ accountId: 'a1', mode: 'tag', tagId: 'pension' }],
      targetsEnabled: false,
      targets: {},
      deviationThreshold: new Decimal(5),
    });
    const p = listPortfolios(db, 'u1').find((x) => x.id === id)!;
    const s = area(db, portfolioScope(p));
    expect(s.cells.map((c) => c.ticker)).toEqual(['SBER']);
    expect(s.value.toFixed()).toBe('31000');
    expect(s.invested.toFixed()).toBe('30000');
  });

  it('a whole-account portfolio sees everything', () => {
    const db = setup();
    savePortfolio(db, 'u1', {
      name: 'Всё',
      rules: [{ accountId: 'a1', mode: 'all', tagId: null }],
      targetsEnabled: true,
      targets: { stocks: new Decimal(60), cash: new Decimal(40) },
      deviationThreshold: new Decimal(5),
    });
    const p = listPortfolios(db, 'u1')[0]!;
    const s = area(db, portfolioScope(p));
    expect(new Set(s.cells.map((c) => c.ticker))).toEqual(new Set(['SBER', 'LKOH', 'RUB']));
    expect(p.targets.get('stocks')!.toFixed()).toBe('60');
  });

  it('checks targets, tags and ownership, and deleting leaves operations alone', () => {
    const db = setup();
    const base = { name: 'X', targetsEnabled: true, deviationThreshold: new Decimal(5) };
    expect(() =>
      savePortfolio(db, 'u1', {
        ...base,
        rules: [{ accountId: 'a1', mode: 'all', tagId: null }],
        targets: { stocks: new Decimal(50) },
      }),
    ).toThrow(/TARGETS/);
    expect(() =>
      savePortfolio(db, 'u1', {
        ...base,
        targetsEnabled: false,
        targets: {},
        rules: [{ accountId: 'a1', mode: 'tag', tagId: null }],
      }),
    ).toThrow(/TAG/);
    expect(() =>
      savePortfolio(db, 'u2', {
        ...base,
        targetsEnabled: false,
        targets: {},
        rules: [{ accountId: 'a1', mode: 'all', tagId: null }],
      }),
    ).toThrow(/ACCOUNT/);
    const id = savePortfolio(db, 'u1', {
      ...base,
      targetsEnabled: false,
      targets: {},
      rules: [{ accountId: 'a1', mode: 'all', tagId: null }],
    });
    deletePortfolio(db, 'u1', id);
    expect(listPortfolios(db, 'u1')).toEqual([]);
    expect(db.select().from(operations).all()).toHaveLength(3);
  });
});

function db0() {
  return setup();
}

describe('display currency', () => {
  it('converts each day at the rate of that day, falling back to the earliest known', () => {
    const fx = new Map([
      [
        'USD',
        [
          { date: '2026-01-02', rate: '100' },
          { date: '2026-01-05', rate: '80' },
        ],
      ],
    ]);
    const series = [
      { date: '2026-01-01', value: new Decimal(1000), invested: new Decimal(500) },
      { date: '2026-01-03', value: new Decimal(1000), invested: new Decimal(500) },
      { date: '2026-01-05', value: new Decimal(1000), invested: new Decimal(500) },
    ];
    expect(convertSeries(series, fx, 'USD').map((p) => p.value)).toEqual([10, 10, 12.5]);
    expect(convertSeries(series, fx, 'RUB').map((p) => p.invested)).toEqual([500, 500, 500]);
  });
});

describe('«Срез на дату»', () => {
  it('a past day: quantities and values of its snapshot, cost from the journal up to its end', () => {
    const db = createTestDb();
    seedAccount(db);
    seedShare(db, 'sber', 'SBER');
    seedShare(db, 'lkoh', 'LKOH');
    const at = (d: string) => new Date(`${d}T09:00:00Z`);
    insertOperation(db, { type: 'deposit', amount: '100000', executedAt: at('2026-01-01') });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'sber',
      quantity: '100',
      price: '300',
      amount: '-30000',
      executedAt: at('2026-01-05'),
    });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'lkoh',
      quantity: '2',
      price: '7000',
      amount: '-14000',
      executedAt: at('2026-01-20'),
    });
    recalcAccount(db, 'a1');
    db.insert(prices)
      .values([
        { instrumentId: 'sber', date: '2026-01-05', close: '300', currency: 'RUB', source: 'moex' },
        { instrumentId: 'sber', date: '2026-01-10', close: '320', currency: 'RUB', source: 'moex' },
        { instrumentId: 'lkoh', date: '2026-01-20', close: '7000', currency: 'RUB', source: 'moex' },
      ])
      .run();
    rebuildAccountSnapshots(db, 'a1', '2026-01-25', tz);
    expect(firstSnapshotDate(db, 'u1')).toBe('2026-01-01');

    const fx = loadFx(db);
    const end = endOfLocalDay('2026-01-10', tz);
    expect(end.toISOString()).toBe('2026-01-10T20:59:59.999Z');
    const ledger = ledgerUntil(loadUserLedger(db, 'u1'), end);
    const cells = loadValuedCellsAt(db, 'u1', '2026-01-10', ledger, fx);
    // LKOH was bought later: not there yet.
    expect(cells.map((c) => [c.ticker, c.quantity.toFixed(), c.valueRub.toFixed()]).sort()).toEqual([
      ['RUB', '70000', '70000'],
      ['SBER', '100', '32000'],
    ]);
    const sber = cells.find((c) => c.ticker === 'SBER')!;
    expect([sber.priceRub!.toFixed(), sber.avgPriceRub!.toFixed(), sber.costRub!.toFixed()]).toEqual([
      '320',
      '300',
      '30000',
    ]);
    const s = summarizeArea(db, 'u1', everything, cells, ledger, fx, tz, null, end);
    expect([s.value.toFixed(), s.invested.toFixed(), s.profit.toFixed()]).toEqual([
      '102000',
      '100000',
      '2000',
    ]);
    // The day before closed at 300: +2 000 that day.
    expect(s.dayChange!.toFixed()).toBe('2000');
  });
});
