import { and, asc, eq, like } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { loadPriceSeries } from '@/db/mutations/market';
import { keyRates, operations } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { Scope } from '@/domain/scope';
import { valueOn } from '@/domain/timeline';
import { intoDeposit, intoIndex, type DayValue } from '@/domain/whatif';
import { eachDay, localDate } from '@/lib/time';
import { ensureBenchmarks } from './benchmarks';
import { areaSeries, flowsFor, type FxSeries, type UserLedger } from './portfolio-data';

export const WHATIF_CHOICES = ['MCFTR', 'RGBITR', 'key', 'deposit'] as const;
export type WhatIfChoice = (typeof WHATIF_CHOICES)[number];

export interface WhatIfOptions {
  /** Payouts the broker sent to a card count as the portfolio's cash, not as a withdrawal. */
  payoutsToCard: boolean;
  /** Percent a year off the alternative: a fund's fee, the gap of a bank's rate to the key rate. */
  adjustPct: Decimal;
  /** A deposit's interest is added to it monthly; without, it is paid aside. */
  compound: boolean;
}

export const DEFAULT_WHATIF_OPTIONS: WhatIfOptions = {
  payoutsToCard: false,
  adjustPct: new Decimal(0),
  compound: true,
};

/** The withdrawals the T-Invest import made for payouts sent to a card (external id «…:card»). */
function cardPayoutIds(db: Db, userId: string): Set<string> {
  return new Set(
    db
      .select({ id: operations.id })
      .from(operations)
      .where(
        and(
          eq(operations.userId, userId),
          eq(operations.type, 'withdrawal'),
          like(operations.externalId, '%:card'),
        ),
      )
      .all()
      .map((r) => r.id),
  );
}

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
  /** Payouts sent to a card counted back into the portfolio, rubles; zero with the option off. */
  keptPayouts: Decimal;
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
  options: WhatIfOptions = DEFAULT_WHATIF_OPTIONS,
): WhatIfData | null {
  const all = flowsFor(ledger, scope, fx, timeZone);
  // Payouts the broker sent to a card: with the option on they stay the portfolio's, as cash on the
  // account, and the alternative does not withdraw them either (an index reinvests its dividends).
  const toCard = options.payoutsToCard ? cardPayoutIds(db, userId) : new Set<string>();
  const flows = all.filter((f) => !toCard.has(f.operationId));
  const kept = all.filter((f) => toCard.has(f.operationId));
  if (flows.length === 0) return null;
  const today = localDate(now, timeZone);
  const moves = flows.map((f) => ({ date: localDate(f.at, timeZone), amount: f.amountRub }));
  const from = moves.reduce((m, f) => (f.date < m ? f.date : m), moves[0]!.date);
  const days = eachDay(from, today);
  const keptBy = (date: string) =>
    kept.reduce((s, f) => (localDate(f.at, timeZone) <= date ? s.minus(f.amountRub) : s), new Decimal(0));
  const keptNow = keptBy(today);
  liveValue = liveValue.plus(keptNow);
  const series = areaSeries(db, userId, scope, flows, liveValue, timeZone, now).map((p) =>
    p.date === today ? p : { ...p, value: p.value.plus(keptBy(p.date)) },
  );
  const adjust = options.adjustPct;

  let alt: DayValue[];
  if (choice === 'deposit') {
    // The owner's own rate is already what they would get: no adjustment on top of it.
    const r = rate ?? new Decimal(0);
    alt = intoDeposit(moves, () => r, days, options.compound);
  } else if (choice === 'key') {
    const rows = db.select().from(keyRates).orderBy(asc(keyRates.date)).all();
    alt = rows.length
      ? intoDeposit(
          moves,
          // Banks pay below the key rate: the adjustment takes that many points off.
          (d) => new Decimal((valueOn(rows, d) ?? rows[0]!).rate).minus(adjust),
          days,
          options.compound,
        )
      : [];
  } else {
    const id = ensureBenchmarks(db).get(choice)!;
    // A fund on the index charges a fee: the adjustment a year.
    alt = intoIndex(moves, loadPriceSeries(db, [id]).get(id) ?? [], days, adjust);
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
      keptPayouts: keptNow,
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
    keptPayouts: keptNow,
  };
}
