import { asc } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { loadPriceSeries } from '@/db/mutations/market';
import { keyRates } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { Scope } from '@/domain/scope';
import { valueOn } from '@/domain/timeline';
import { intoDeposit, intoIndex, type DayValue } from '@/domain/whatif';
import { eachDay, localDate } from '@/lib/time';
import { ensureBenchmarks } from './benchmarks';
import { areaSeries, flowsFor, type FxSeries, type UserLedger } from './portfolio-data';

export const WHATIF_CHOICES = ['MCFTR', 'RGBITR', 'key', 'deposit'] as const;
export type WhatIfChoice = (typeof WHATIF_CHOICES)[number];

export interface WhatIfData {
  choice: WhatIfChoice;
  /** The annual rate of «свой процент». */
  rate: Decimal | null;
  from: string;
  /** Per day: what the area is worth and what the same money would be worth there. */
  points: { date: string; actual: Decimal; alt: Decimal }[];
  actual: Decimal;
  alt: Decimal;
  /** Actual minus the alternative: + the area did better. */
  diff: Decimal;
  /** The alternative has no data yet (an index or the key rate before the first backfill). */
  missing: boolean;
}

/**
 * «А если бы» (FR-PRT-8, docs/04 section 15): the area's own deposits and withdrawals, on their days,
 * put into an index or a deposit instead, against what the area is worth.
 */
export function whatIfData(
  db: Db,
  userId: string,
  scope: Scope,
  ledger: UserLedger,
  fx: FxSeries,
  liveValue: Decimal,
  timeZone: string,
  choice: WhatIfChoice,
  rate: Decimal | null,
  now = new Date(),
): WhatIfData | null {
  const flows = flowsFor(ledger, scope, fx, timeZone);
  if (flows.length === 0) return null;
  const today = localDate(now, timeZone);
  const moves = flows.map((f) => ({ date: localDate(f.at, timeZone), amount: f.amountRub }));
  const from = moves.reduce((m, f) => (f.date < m ? f.date : m), moves[0]!.date);
  const days = eachDay(from, today);
  const series = areaSeries(db, userId, scope, flows, liveValue, timeZone, now);

  let alt: DayValue[];
  if (choice === 'deposit') {
    const r = rate ?? new Decimal(0);
    alt = intoDeposit(moves, () => r, days);
  } else if (choice === 'key') {
    const rows = db.select().from(keyRates).orderBy(asc(keyRates.date)).all();
    alt = rows.length
      ? intoDeposit(moves, (d) => new Decimal((valueOn(rows, d) ?? rows[0]!).rate), days)
      : [];
  } else {
    const id = ensureBenchmarks(db).get(choice)!;
    alt = intoIndex(moves, loadPriceSeries(db, [id]).get(id) ?? [], days);
  }
  if (alt.length === 0) {
    return {
      choice,
      rate,
      from,
      points: [],
      actual: liveValue,
      alt: new Decimal(0),
      diff: new Decimal(0),
      missing: true,
    };
  }
  const altOn = new Map(alt.map((d) => [d.date, d.value]));
  // The days the area has a value for: a snapshot, and today live.
  const points = series
    .filter((p) => altOn.has(p.date))
    .map((p) => ({ date: p.date, actual: p.value, alt: altOn.get(p.date)! }));
  const last = alt.at(-1)!.value;
  return {
    choice,
    rate,
    from,
    points,
    actual: liveValue,
    alt: last,
    diff: liveValue.minus(last),
    missing: false,
  };
}
