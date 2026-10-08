import { describe, expect, it } from 'vitest';
import { allocation, targetsValid, type AssetClass } from './allocation';
import { Decimal } from './decimal';
import { dayChange, externalFlows, invested, type FlowOperation } from './flows';
import type { LedgerContext } from './ledger-types';
import { everything, scopeOf } from './scope';

const D = (v: string | number) => new Decimal(v);

describe('эталон 7.1: структура и отклонения', () => {
  it('shares and deviations against 40/25/15/15/5', () => {
    const values = new Map<AssetClass, Decimal>([
      ['stocks', D(1130600)],
      ['bonds', D(570600)],
      ['funds', D(387400)],
      ['crypto', D(613100)],
      ['cash', D(244500)],
    ]);
    const targets = new Map<AssetClass, Decimal>([
      ['stocks', D(40)],
      ['bonds', D(25)],
      ['funds', D(15)],
      ['crypto', D(15)],
      ['cash', D(5)],
    ]);
    const a = allocation(values, targets, D(5));
    expect(a.map((c) => c.share.toFixed(1))).toEqual(['38.4', '19.4', '13.1', '20.8', '8.3']);
    expect(a.map((c) => c.deviation!.toFixed(1))).toEqual(['-1.6', '-5.6', '-1.9', '5.8', '3.3']);
    expect(a.filter((c) => c.offTarget).map((c) => c.assetClass)).toEqual(['bonds', 'crypto']);
  });

  it('skips empty classes without a target and checks the 100 % rule', () => {
    expect(allocation(new Map([['stocks', D(10)]]), null, D(5)).map((c) => c.assetClass)).toEqual(['stocks']);
    expect(targetsValid([D(40), D(25), D(15), D(15), D(5)])).toBe(true);
    expect(targetsValid([D(40), D(25), D(15)])).toBe(false);
    expect(targetsValid([D(110), D(-10)])).toBe(false);
  });
});

describe('эталон 3.1 и раздел 6', () => {
  it('profit and its share of what was invested', () => {
    const profit = D(4812360).minus(D(4199460));
    expect(profit.toFixed()).toBe('612900');
    expect(profit.div(4199460).times(100).toFixed(2)).toBe('14.59');
  });

  it('day change leaves the day’s flow out', () => {
    const d = dayChange(D(1015000), D(1000000), D(10000));
    expect(d.change.toFixed()).toBe('5000');
    expect(d.pct!.toFixed(2)).toBe('0.50');
    expect(dayChange(D(5), D(0), D(5)).pct).toBeNull();
  });
});

describe('external flows', () => {
  const ctx = (defaultTag: string | null): LedgerContext => ({
    tagRules: new Map(),
    accountDefaultTagId: defaultTag,
    cashInstrumentId: (c) => `cash-${c}`,
    deductFees: true,
  });
  const ctxs = new Map([['a1', ctx('main')]]);
  let n = 0;
  const op = (f: Partial<FlowOperation> & Pick<FlowOperation, 'type'>): FlowOperation => ({
    id: `o${++n}`,
    accountId: 'a1',
    executedAt: new Date(Date.UTC(2026, 0, n)),
    createdAt: new Date(0),
    instrumentId: null,
    quantity: D(0),
    price: D(0),
    currency: 'RUB',
    amount: D(0),
    fee: D(0),
    tax: D(0),
    accruedInterest: D(0),
    tagId: null,
    voided: false,
    ...f,
  });
  const ops = [
    op({ type: 'deposit', amount: D(100000) }),
    op({
      type: 'buy',
      instrumentId: 'sber',
      tagId: 'pension',
      quantity: D(10),
      price: D(300),
      amount: D(-3000),
    }),
    op({ type: 'buy', instrumentId: 'lkoh', quantity: D(1), price: D(7000), amount: D(-7000) }),
    op({ type: 'dividend', instrumentId: 'sber', tagId: 'pension', amount: D(150) }),
    op({ type: 'accrual', instrumentId: 'steth', quantity: D('0.001') }),
    op({ type: 'withdrawal', amount: D(-5000) }),
    op({ type: 'deposit', amount: D(100), currency: 'USD' }),
  ];
  const rub = (c: string) => (c === 'USD' ? D(90) : D(1));

  it('for the whole account: only deposits and withdrawals, foreign currency in rubles', () => {
    const f = externalFlows(ops, ctxs, everything, rub);
    expect(f.map((x) => x.amountRub.toFixed())).toEqual(['100000', '-5000', '9000']);
    expect(invested(f).toFixed()).toBe('104000');
  });

  it('for a tag: buying with cash from outside is a flow in, payouts leaving are flows out', () => {
    const pension = scopeOf([{ accountId: 'a1', mode: 'tag', tagId: 'pension' }]);
    const f = externalFlows(ops, ctxs, pension, rub);
    expect(f.map((x) => x.amountRub.toFixed())).toEqual(['3000', '-150']);
  });

  it('for the default tag: money spent on other tags leaves, their payouts come back', () => {
    const main = scopeOf([{ accountId: 'a1', mode: 'tag', tagId: 'main' }]);
    const f = externalFlows(ops, ctxs, main, rub);
    // deposit +100 000, buy SBER for «pension» −3 000, dividend from «pension» +150, withdrawal −5 000, USD +9 000
    expect(f.map((x) => x.amountRub.toFixed())).toEqual(['100000', '-3000', '150', '-5000', '9000']);
  });

  it('an account outside the portfolio has no flows', () => {
    expect(externalFlows(ops, ctxs, scopeOf([]), rub)).toEqual([]);
  });
});
