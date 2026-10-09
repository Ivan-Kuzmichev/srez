import { describe, expect, it } from 'vitest';
import { accrualKind, accruedBeforeConnection, rebasingAccrual, wrappedAccrual } from './accruals';
import { Decimal } from './decimal';

const D = (v: string | number) => new Decimal(v);

describe('эталоны 10.1–10.3: начисления', () => {
  it('10.1: 1 000,00 → 1 000,14 without transfers gives 0,14', () => {
    expect(
      rebasingAccrual({
        yesterday: D('1000.00'),
        today: D('1000.14'),
        inflows: D(0),
        outflows: D(0),
      }).toFixed(2),
    ).toBe('0.14');
  });

  it('10.2: 500,00 arrived during the day, 1 500,20 at the end gives 0,20', () => {
    expect(
      rebasingAccrual({
        yesterday: D('1000.00'),
        today: D('1500.20'),
        inflows: D('500.00'),
        outflows: D(0),
      }).toFixed(2),
    ).toBe('0.20');
  });

  it('10.3: a wrapper of 2,0 at 1,1500 → 1,1502 gives 0,0004 of the base coin', () => {
    expect(
      wrappedAccrual({ quantity: D('2.0'), rateYesterday: D('1.1500'), rateToday: D('1.1502') }).toFixed(4),
    ).toBe('0.0004');
  });
});

describe('accrual edge cases', () => {
  it('outflows are added back; a fall is a penalty; zero books nothing', () => {
    expect(
      rebasingAccrual({ yesterday: D(100), today: D('60.01'), inflows: D(0), outflows: D(40) }).toFixed(2),
    ).toBe('0.01');
    expect(accrualKind(D('-0.5'))).toBe('other');
    expect(accrualKind(D(0))).toBeNull();
    expect(accrualKind(D('0.0001'))).toBe('accrual');
  });

  it('before connection: the balance beyond what arrived', () => {
    expect(accruedBeforeConnection({ current: D('2.0123'), inflows: D('2'), outflows: D(0) }).toFixed()).toBe(
      '0.0123',
    );
  });
});
