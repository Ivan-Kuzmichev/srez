import { describe, expect, it } from 'vitest';
import { finAccounts } from '@/db/schema';
import { insertOperation, seedAccount } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { scopeOf } from '@/domain/scope';
import { holdsIis, portfolioDeposits } from './deposits-data';
import { loadFx, loadUserLedger } from './portfolio-data';

const tz = 'Europe/Moscow';

describe('«Цель пополнений»: the deposits of a portfolio', () => {
  it('money from outside counts, a transfer inside the portfolio does not', () => {
    const db = createTestDb();
    seedAccount(db);
    db.insert(finAccounts)
      .values({ id: 'a2', userId: 'u1', sourceId: 's1', name: 'ИИС', kind: 'iis', currency: 'RUB' })
      .run();
    const at = (d: string) => new Date(`${d}T09:00:00Z`);
    insertOperation(db, { type: 'deposit', amount: '10000', executedAt: at('2026-01-05') });
    // A broker transfer from the brokerage account to the ИИС: both sides share the broker's id.
    insertOperation(db, {
      type: 'withdrawal',
      amount: '-5000',
      executedAt: at('2026-02-10'),
      origin: 'tinvest',
      externalId: '2000000001:t-1',
    });
    insertOperation(db, {
      type: 'deposit',
      accountId: 'a2',
      amount: '5000',
      executedAt: at('2026-02-10'),
      origin: 'tinvest',
      externalId: '2000000002:t-1',
    });
    insertOperation(db, {
      type: 'deposit',
      amount: '700',
      executedAt: at('2026-03-01'),
      voidedAt: at('2026-03-02'),
    });
    const ledger = loadUserLedger(db, 'u1');
    const fx = loadFx(db);
    const of = (accounts: string[]) =>
      portfolioDeposits(
        db,
        'u1',
        scopeOf(accounts.map((accountId) => ({ accountId, mode: 'all' as const, tagId: null }))),
        ledger,
        fx,
        tz,
      ).map((d) => `${d.date} ${d.amount.toFixed()}`);
    expect(of(['a1'])).toEqual(['2026-01-05 10000']);
    // To the ИИС alone the transfer is a deposit: the deduction counts it too.
    expect(of(['a2'])).toEqual(['2026-02-10 5000']);
    expect(of(['a1', 'a2'])).toEqual(['2026-01-05 10000']);
    expect([holdsIis(db, 'u1', ['a1']), holdsIis(db, 'u1', ['a1', 'a2']), holdsIis(db, 'u1', [])]).toEqual([
      false,
      true,
      false,
    ]);
  });
});
