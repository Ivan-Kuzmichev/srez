import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { holdingGroup, realizedSummary, tradeRows, type ClosedPiece, type SaleInfo } from './realized';

const D = (v: string | number) => new Decimal(v);
const date = (s: string) => new Date(`${s}T12:00:00Z`);

describe('эталон 13.1: прибыль за год', () => {
  it('sales +750 (+18 450 / −17 700), total +184 362', () => {
    const pnl = [-1200, 9800, 4200, -16500, 4450];
    const sales: SaleInfo[] = pnl.map((_, i) => ({
      saleId: `s${i}`,
      instrumentId: `i${i}`,
      accountId: 'a',
      assetClass: i === 3 ? 'crypto' : 'stocks',
      closedAt: date('2026-06-01'),
    }));
    const pieces: ClosedPiece[] = pnl.map((p, i) => ({
      saleId: `s${i}`,
      openedAt: date('2025-01-01'),
      closedAt: date('2026-06-01'),
      quantity: D(1),
      costRub: D(100000),
      proceedsRub: D(100000 + p),
    }));
    const s = realizedSummary(tradeRows(pieces, sales, 'fifo'), D(210108), D(2316), D(24180));
    expect(s.sales.toFixed()).toBe('750');
    expect(s.gains.toFixed()).toBe('18450');
    expect(s.losses.toFixed()).toBe('-17700');
    expect(s.total.toFixed()).toBe('184362');
  });
});

describe('closed trades', () => {
  const sale: SaleInfo = {
    saleId: 's',
    instrumentId: 'sber',
    accountId: 'a',
    assetClass: 'stocks',
    closedAt: date('2026-10-08'),
  };
  // 100 bought in 2022 at 200, 20 bought in March 2026 at 250, all sold at 300.
  const pieces: ClosedPiece[] = [
    {
      saleId: 's',
      openedAt: date('2022-06-01'),
      closedAt: date('2026-10-08'),
      quantity: D(100),
      costRub: D(20000),
      proceedsRub: D(30000),
    },
    {
      saleId: 's',
      openedAt: date('2026-03-01'),
      closedAt: date('2026-10-08'),
      quantity: D(20),
      costRub: D(5000),
      proceedsRub: D(6000),
    },
  ];

  it('holding groups by calendar years', () => {
    expect(holdingGroup(date('2025-10-09'), date('2026-10-08'))).toBe('under1');
    expect(holdingGroup(date('2025-10-08'), date('2026-10-08'))).toBe('from1to3');
    expect(holdingGroup(date('2023-10-08'), date('2026-10-08'))).toBe('from1to3');
    expect(holdingGroup(date('2023-10-07'), date('2026-10-08'))).toBe('over3');
  });

  it('a sale over lots of different ages splits by holding group', () => {
    const rows = tradeRows(pieces, [sale], 'fifo');
    expect(
      rows.map((r) => [
        r.group,
        r.quantity.toFixed(),
        r.buyPrice.toFixed(),
        r.sellPrice.toFixed(),
        r.pnl.toFixed(),
      ]),
    ).toEqual([
      ['over3', '100', '200', '300', '10000'],
      ['under1', '20', '250', '300', '1000'],
    ]);
    const s = realizedSummary(rows, D(0), D(0), D(0));
    expect(s.byClass).toEqual([{ assetClass: 'stocks', trades: 1, pnl: D(11000) }]);
    expect(s.byGroup.map((g) => [g.group, g.trades, g.pnl.toFixed()])).toEqual([
      ['under1', 1, '1000'],
      ['over3', 1, '10000'],
    ]);
  });

  it('the average method spreads the average cost over the groups by quantity', () => {
    const rows = tradeRows(
      pieces,
      [sale],
      'average',
      new Map([['s', { saleId: 's', quantity: D(120), proceedsRub: D(36000), averageCostRub: D(26400) }]]),
    );
    expect(rows.map((r) => [r.group, r.buyPrice.toFixed(), r.pnl.toFixed()])).toEqual([
      ['over3', '220', '8000'],
      ['under1', '220', '1600'],
    ]);
  });
});
