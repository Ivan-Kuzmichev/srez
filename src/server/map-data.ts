import { and, eq, inArray, min } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { loadPriceSeries } from '@/db/mutations/market';
import { operations } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { valueOn } from '@/domain/timeline';
import { addDays, localDate } from '@/lib/time';
import { rubPer, type FxSeries, type ValuedCell } from './portfolio-data';

export const MAP_PERIODS = ['1d', '1w', '1m', '6m', '1y', 'all'] as const;
export type MapPeriod = (typeof MAP_PERIODS)[number];
const DAYS_BACK: Record<Exclude<MapPeriod, 'all'>, number> = {
  '1d': 1,
  '1w': 7,
  '1m': 30,
  '6m': 182,
  '1y': 365,
};

export interface MapTile {
  instrumentId: string;
  isCash: boolean;
  kind: string;
  ticker: string | null;
  name: string;
  value: Decimal;
  /** Percent of the area's value. */
  share: Decimal;
  /** The price change over each period, percent; null when the history does not reach back. */
  changes: Record<MapPeriod, Decimal | null>;
}

const ZERO = new Decimal(0);

/**
 * «Карта портфеля» (FR-PRT-11): the area's positions, one tile per instrument, largest first. A
 * security's change is its daily close now against the close on or before the period's start, in its
 * own currency; money moves with its CBR rate (the ruble does not). «Всё» starts at the first operation.
 */
export function mapTiles(
  db: Db,
  userId: string,
  cells: ValuedCell[],
  fx: FxSeries,
  timeZone: string,
  now = new Date(),
): MapTile[] {
  const byInstrument = new Map<string, { cell: ValuedCell; value: Decimal }>();
  for (const c of cells) {
    if (c.valueRub.lte(0)) continue;
    const t = byInstrument.get(c.instrumentId);
    byInstrument.set(c.instrumentId, { cell: t?.cell ?? c, value: (t?.value ?? ZERO).plus(c.valueRub) });
  }
  const held = [...byInstrument.values()].sort((a, b) => b.value.comparedTo(a.value));
  const total = held.reduce((s, h) => s.plus(h.value), ZERO);
  if (total.isZero()) return [];

  const today = localDate(now, timeZone);
  const ids = held.filter((h) => !h.cell.isCash).map((h) => h.cell.instrumentId);
  const series = loadPriceSeries(db, ids);
  const firstOp = new Map(
    (ids.length
      ? db
          .select({ id: operations.instrumentId, at: min(operations.executedAt) })
          .from(operations)
          .where(and(eq(operations.userId, userId), inArray(operations.instrumentId, ids)))
          .groupBy(operations.instrumentId)
          .all()
      : []
    ).map((r) => [r.id!, r.at ? localDate(r.at, timeZone) : null]),
  );
  const startOf = (period: MapPeriod, id: string): string | null =>
    period === 'all' ? (firstOp.get(id) ?? null) : addDays(today, -DAYS_BACK[period]);

  return held.map(({ cell: c, value }) => {
    const changes = {} as Record<MapPeriod, Decimal | null>;
    for (const period of MAP_PERIODS) {
      const start = startOf(period, c.instrumentId);
      let change: Decimal | null = null;
      if (c.isCash) {
        const code = c.ticker ?? c.currency;
        const then = start ? rubPer(fx, code, start) : null;
        const nowRate = rubPer(fx, code);
        change =
          code === 'RUB'
            ? ZERO
            : then && nowRate && then.gt(0)
              ? nowRate.div(then).minus(1).times(100)
              : null;
      } else if (start) {
        const points = series.get(c.instrumentId) ?? [];
        const last = valueOn(points, today);
        const first = valueOn(points, start);
        // The history must reach the start: a close from after it would understate the move.
        if (last && first && first.date !== last.date && new Decimal(first.close).gt(0))
          change = new Decimal(last.close).div(first.close).minus(1).times(100);
        else if (last && first) change = ZERO;
      }
      changes[period] = change;
    }
    return {
      instrumentId: c.instrumentId,
      isCash: c.isCash,
      kind: c.kind,
      ticker: c.ticker,
      name: c.name,
      value,
      share: value.div(total).times(100),
      changes,
    };
  });
}
