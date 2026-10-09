import { describe, expect, it } from 'vitest';
import { prices } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { Decimal } from '@/domain/decimal';
import { ensureBenchmarks } from './benchmarks';
import { areaReturns, areaXirr } from './portfolio-data';

const d = (v: number | string) => new Decimal(v);

describe('areaReturns', () => {
  it('gives XIRR, a TWR growth line, the benchmark carried over holidays, and the gap in points', () => {
    const db = createTestDb();
    const mcftr = ensureBenchmarks(db).get('MCFTR')!;
    db.insert(prices)
      .values([
        { instrumentId: mcftr, date: '2025-10-01', close: '100', currency: 'RUB', source: 'moex' },
        { instrumentId: mcftr, date: '2026-10-02', close: '115', currency: 'RUB', source: 'moex' },
      ])
      .run();
    const series = [
      { date: '2025-10-01', value: d(100_000), invested: d(100_000) },
      { date: '2026-01-01', value: d(160_000), invested: d(150_000) },
      { date: '2026-10-03', value: d(176_000), invested: d(150_000) },
    ];
    const flows = [
      { operationId: 'a', at: new Date('2025-10-01T09:00:00Z'), amountRub: d(100_000) },
      { operationId: 'b', at: new Date('2026-01-01T09:00:00Z'), amountRub: d(50_000) },
    ];
    const now = new Date('2026-10-03T12:00:00Z');
    const r = areaReturns(db, series, flows, d(176_000), mcftr, 'Europe/Moscow', now);
    // Growth: 1 → (160 000 − 50 000) / 100 000 = 1.1 → × 176 000 / 160 000 = 1.21.
    expect(r.points.map((p) => p.growth.toString())).toEqual(['1', '1.1', '1.21']);
    // The index has no close on 3 October: the one of the 2nd carries over.
    expect(r.points.map((p) => p.bench?.toString() ?? null)).toEqual(['100', '100', '115']);
    // A year back from 3 October 2026 the last value is the one of 1 October 2025.
    expect(r.year).toMatchObject({ from: '2025-10-01', fullYear: true });
    expect(r.year.portfolio?.toString()).toBe('0.21');
    expect(r.year.benchmark?.toString()).toBe('0.15');
    expect(r.year.pp?.toString()).toBe('6');
    const young = areaReturns(db, series.slice(1), flows.slice(1), d(176_000), mcftr, 'Europe/Moscow', now);
    expect(young.year).toMatchObject({ from: '2026-01-01', fullYear: false });
    expect(r.xirr?.rate.gt(0)).toBe(true);
    expect(areaXirr(flows, d(176_000), 'Europe/Moscow', now)?.rate.toString()).toBe(r.xirr?.rate.toString());
  });
});
