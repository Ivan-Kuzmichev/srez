import { describe, expect, it } from 'vitest';
import { deletePortfolio, savePortfolio } from '@/db/mutations/portfolios';
import { recalcAccount } from '@/db/mutations/positions';
import { finAccounts, operations, pricesLast, tags } from '@/db/schema';
import { insertOperation, seedAccount, seedShare } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import {
  everything,
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
