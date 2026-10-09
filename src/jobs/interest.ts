import { and, desc, eq, inArray, min } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '@/db/client';
import { finAccounts, instruments, operations, positions } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { interestDates, monthlyInterest } from '@/domain/payouts';
import { addDays, localDate, zonedLocalToUtc } from '@/lib/time';
import { ownerSettings } from '@/server/settings';
import { enqueueRecalc } from './positions';
import { defineJob } from './runner';

export const INTEREST_JOB = 'interest.accrue';

/**
 * docs/04-calculations.md, section 9: a custom asset valued at an annual rate gets an `interest`
 * operation every month on its opening day, principal × rate / 12. It starts after the last interest
 * already in the journal, typed by hand or not, and a repeated run adds nothing (external id per month).
 */
export function accrueInterest(db: Executor, now = new Date()): number {
  const tz = ownerSettings(db).display.timezone;
  const today = localDate(now, tz);
  const assets = db
    .select({ id: instruments.id, meta: instruments.meta, currency: instruments.currency })
    .from(instruments)
    .where(eq(instruments.kind, 'custom'))
    .all()
    .filter(
      (i) =>
        i.meta?.valuation === 'interest' &&
        typeof i.meta.annualRate === 'string' &&
        new Decimal(i.meta.annualRate).gt(0),
    );
  if (assets.length === 0) return 0;
  let added = 0;

  const held = db
    .select({
      accountId: positions.accountId,
      instrumentId: positions.instrumentId,
      userId: positions.userId,
      quantity: positions.quantity,
      cost: positions.costBasis,
    })
    .from(positions)
    .where(
      inArray(
        positions.instrumentId,
        assets.map((a) => a.id),
      ),
    )
    .all();
  const cells = new Map<
    string,
    { accountId: string; instrumentId: string; userId: string; quantity: Decimal; cost: Decimal }
  >();
  for (const p of held) {
    const key = `${p.accountId}|${p.instrumentId}`;
    const c = cells.get(key) ?? {
      accountId: p.accountId,
      instrumentId: p.instrumentId,
      userId: p.userId,
      quantity: new Decimal(0),
      cost: new Decimal(0),
    };
    c.quantity = c.quantity.plus(p.quantity);
    c.cost = c.cost.plus(p.cost);
    cells.set(key, c);
  }

  for (const c of cells.values()) {
    if (c.quantity.lte(0) || c.cost.lte(0)) continue;
    const asset = assets.find((a) => a.id === c.instrumentId)!;
    const account = db
      .select({ sourceId: finAccounts.sourceId })
      .from(finAccounts)
      .where(eq(finAccounts.id, c.accountId))
      .get();
    if (!account) continue;
    const ofCell = and(eq(operations.accountId, c.accountId), eq(operations.instrumentId, c.instrumentId));
    const first = db
      .select({ at: min(operations.executedAt) })
      .from(operations)
      .where(ofCell)
      .get()?.at;
    if (!first) continue;
    const opened = localDate(new Date(first), tz);
    const lastInterest = db
      .select({ at: operations.executedAt })
      .from(operations)
      .where(and(ofCell, eq(operations.type, 'interest')))
      .orderBy(desc(operations.executedAt))
      .get()?.at;
    const from = lastInterest ? addDays(localDate(lastInterest, tz), 1) : addDays(opened, 1);
    const amount = monthlyInterest(c.cost, new Decimal(asset.meta!.annualRate as string)).toDecimalPlaces(2);
    let inserted = 0;
    for (const date of interestDates(opened, from, today)) {
      const res = db
        .insert(operations)
        .values({
          userId: c.userId,
          accountId: c.accountId,
          instrumentId: c.instrumentId,
          type: 'interest',
          executedAt: zonedLocalToUtc(`${date}T12:00`, tz) ?? new Date(`${date}T09:00:00Z`),
          currency: asset.currency,
          amount: amount.toString(),
          origin: 'manual',
          sourceId: account.sourceId,
          externalId: `interest:${c.accountId}:${c.instrumentId}:${date.slice(0, 7)}`,
          note: `${asset.meta!.annualRate} % годовых`,
        })
        .onConflictDoNothing()
        .run();
      inserted += res.changes;
    }
    if (inserted > 0) enqueueRecalc(db, c.accountId);
    added += inserted;
  }
  return added;
}

export const accrueInterestJob = defineJob({
  name: INTEREST_JOB,
  payload: z.null(),
  handler({ db, log }) {
    const added = accrueInterest(db);
    if (added > 0) log.info({ added }, 'Interest accrued');
  },
});
