import { describe, expect, it } from 'vitest';
import { setPositionTag } from '@/db/mutations/operations';
import { tagRules, tags } from '@/db/schema';
import { insertOperation, seedAccount, seedShare } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { journalTotals, listJournal, PAGE_SIZE, type JournalFilters } from './operations';

const now = new Date('2026-10-08T12:00:00Z');
const all: JournalFilters = { period: 'all' };

function setup() {
  const db = createTestDb();
  seedAccount(db);
  seedShare(db, 'sber', 'SBER');
  seedShare(db, 'lkoh', 'LKOH');
  return db;
}

const at = (iso: string) => new Date(iso);

describe('journal', () => {
  it('pages newest first and counts the whole selection', () => {
    const db = setup();
    for (let i = 0; i < PAGE_SIZE + 5; i++) {
      insertOperation(db, { type: 'deposit', amount: '1', executedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) });
    }
    const first = listJournal(db, 'u1', all, 1, now);
    expect(first.total).toBe(PAGE_SIZE + 5);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.rows[0]!.executedAt.getTime()).toBeGreaterThan(first.rows[1]!.executedAt.getTime());
    expect(listJournal(db, 'u1', all, 2, now).rows).toHaveLength(5);
  });

  it('filters by text, type, account, origin and period; hides voided', () => {
    const db = setup();
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'sber',
      quantity: '1',
      price: '300',
      amount: '-300',
      executedAt: at('2026-10-01T10:00:00Z'),
    });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'lkoh',
      quantity: '1',
      price: '7000',
      amount: '-7000',
      executedAt: at('2026-10-02T10:00:00Z'),
      origin: 'tinvest',
      externalId: 'e1',
    });
    insertOperation(db, {
      type: 'dividend',
      instrumentId: 'sber',
      amount: '50',
      executedAt: at('2025-05-01T10:00:00Z'),
    });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'sber',
      quantity: '1',
      price: '1',
      amount: '-1',
      executedAt: at('2026-10-03T10:00:00Z'),
      voidedAt: now,
    });

    const tickers = (f: Partial<JournalFilters>) =>
      listJournal(db, 'u1', { ...all, ...f }, 1, now).rows.map((r) => `${r.type}:${r.ticker}`);
    expect(tickers({})).toEqual(['buy:LKOH', 'buy:SBER', 'dividend:SBER']);
    expect(tickers({ q: 'sb' })).toEqual(['buy:SBER', 'dividend:SBER']);
    expect(tickers({ type: 'payout' })).toEqual(['dividend:SBER']);
    expect(tickers({ origin: 'tinvest' })).toEqual(['buy:LKOH']);
    expect(tickers({ period: '30d' })).toEqual(['buy:LKOH', 'buy:SBER']);
    expect(tickers({ period: 'year' })).toEqual(['buy:LKOH', 'buy:SBER']);
    expect(tickers({ accountId: 'other' })).toEqual([]);
    expect(listJournal(db, 'u2', all, 1, now).total).toBe(0);
  });

  it('totals the selection by kind, fees apart from purchases', () => {
    const db = setup();
    insertOperation(db, { type: 'deposit', amount: '80000' });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'sber',
      quantity: '100',
      price: '312.10',
      fee: '6',
      amount: '-31216',
    });
    insertOperation(db, {
      type: 'sell',
      instrumentId: 'lkoh',
      quantity: '10',
      price: '4190',
      fee: '10',
      amount: '41890',
    });
    insertOperation(db, { type: 'coupon', instrumentId: 'sber', amount: '4248' });
    insertOperation(db, { type: 'fee', amount: '-94' });
    insertOperation(db, { type: 'deposit', amount: '100', currency: 'USD' });
    const t = journalTotals(db, 'u1', all, 'RUB', now);
    expect([t.deposits, t.buys, t.sells, t.payouts, t.fees].map((d) => d.toFixed())).toEqual([
      '80000',
      '-31210',
      '41900',
      '4248',
      '-110',
    ]);
    expect(t.otherCurrency).toBe(1);
  });
});

describe('setPositionTag', () => {
  it('retags every operation of the instrument on the account and remembers the rule', () => {
    const db = setup();
    const pension = db.insert(tags).values({ userId: 'u1', name: 'пенсия' }).returning().get();
    insertOperation(db, { type: 'buy', instrumentId: 'sber', quantity: '1', price: '1', amount: '-1' });
    insertOperation(db, {
      type: 'buy',
      instrumentId: 'sber',
      quantity: '1',
      price: '1',
      amount: '-1',
      origin: 'tinvest',
      externalId: 'x',
    });
    insertOperation(db, { type: 'buy', instrumentId: 'lkoh', quantity: '1', price: '1', amount: '-1' });
    expect(setPositionTag(db, 'u1', 'a1', 'sber', pension.id)).toBe(2);
    const rows = listJournal(db, 'u1', all, 1, now).rows;
    expect(rows.filter((r) => r.ticker === 'SBER').every((r) => r.tagName === 'пенсия')).toBe(true);
    expect(rows.find((r) => r.ticker === 'LKOH')!.tagId).toBeNull();
    expect(db.select().from(tagRules).all()).toEqual([
      expect.objectContaining({ accountId: 'a1', instrumentId: 'sber', tagId: pension.id }),
    ]);

    setPositionTag(db, 'u1', 'a1', 'sber', null);
    expect(db.select().from(tagRules).all()).toEqual([]);
  });
});
