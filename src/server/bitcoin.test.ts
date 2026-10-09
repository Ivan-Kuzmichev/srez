import { describe, expect, it } from 'vitest';
import { fxRates, prices } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { Money } from '@/domain/money';
import { formatChange, formatMoney } from '@/lib/format';
import { benchmarkFor, benchmarkOptions, ensureBitcoin } from './benchmarks';
import { loadFx, rubPer } from './portfolio-data';

const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('bitcoin as a benchmark and a currency', () => {
  it('a bitcoin rate in rubles from its dollar close and the dollar rate of the day', () => {
    const db = createTestDb();
    const btc = ensureBitcoin(db);
    expect(ensureBitcoin(db)).toBe(btc);
    db.insert(fxRates)
      .values({ date: '2026-10-08', base: 'RUB', quote: 'USD', rate: '90', source: 'cbr' })
      .run();
    db.insert(prices)
      .values({ instrumentId: btc, date: '2026-10-08', close: '60000', currency: 'USD', source: 'coingecko' })
      .run();
    expect(rubPer(loadFx(db), 'BTC', '2026-10-09')?.toFixed()).toBe('5400000');
    expect(benchmarkOptions(db).map((b) => b.ticker)).toEqual(['MCFTR', 'RGBITR', 'BTC']);
    expect(benchmarkFor(db, btc, null)).toBe(btc);
  });

  it('amounts in bitcoin keep six decimals', () => {
    expect(plain(formatMoney(Money.of('0.0543219', 'BTC')))).toBe('0,054322 ₿');
    expect(plain(formatChange(Money.of('-0.0012', 'BTC')))).toBe('−0,001200 ₿');
  });
});
