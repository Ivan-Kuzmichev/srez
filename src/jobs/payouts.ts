import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Executor } from '@/db/client';
import { instruments, payoutEvents, positions } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { currencyOf, quotation, TinvestError, type TinvestClient } from '@/integrations/tinvest/client';
import type { Logger } from '@/server/logger';
import { enqueue } from './queue';
import { defineJob } from './runner';
import { tinvestForPrices } from './tinvest-market';

export const PAYOUTS_JOB = 'payouts.refresh';
const BACK_MS = 31 * 86_400_000;
const AHEAD_MS = 366 * 86_400_000;

export function enqueuePayouts(db: Executor, runAt?: Date): void {
  enqueue(db, PAYOUTS_JOB, null, { singletonKey: PAYOUTS_JOB, runAt });
}

type NewEvent = typeof payoutEvents.$inferInsert;
const day = (d: Date | undefined) => (d && d.getTime() > 0 ? d.toISOString().slice(0, 10) : null);

function upsert(db: Executor, events: NewEvent[]): void {
  for (const e of events) {
    db.insert(payoutEvents)
      .values(e)
      .onConflictDoUpdate({
        target: [payoutEvents.instrumentId, payoutEvents.kind, payoutEvents.payDate],
        set: {
          recordDate: e.recordDate,
          amountPerUnit: e.amountPerUnit,
          currency: e.currency,
          isEstimate: e.isEstimate,
          source: e.source,
        },
      })
      .run();
  }
}

/** Securities held anywhere now, with a T-Invest uid. */
function heldWithUid(db: Executor) {
  const held = new Set(
    db
      .select({ id: positions.instrumentId, quantity: positions.quantity })
      .from(positions)
      .all()
      .filter((p) => new Decimal(p.quantity).gt(0))
      .map((p) => p.id),
  );
  if (held.size === 0) return [];
  return db
    .select({
      id: instruments.id,
      kind: instruments.kind,
      externalUid: instruments.externalUid,
      currency: instruments.currency,
      meta: instruments.meta,
    })
    .from(instruments)
    .where(inArray(instruments.id, [...held]))
    .all()
    .filter((i): i is typeof i & { externalUid: string } => i.externalUid !== null && i.kind !== 'currency');
}

/** Coupons and declared dividends a month back and a year ahead, plus bond maturities (FR-PAY-3). */
export async function refreshPayouts(
  db: Db,
  client: TinvestClient,
  log: Logger,
  now = new Date(),
): Promise<number> {
  const from = new Date(now.getTime() - BACK_MS);
  const to = new Date(now.getTime() + AHEAD_MS);
  let count = 0;
  for (const inst of heldWithUid(db)) {
    const events: NewEvent[] = [];
    try {
      if (inst.kind === 'bond') {
        for (const c of await client.getBondCoupons(inst.externalUid, from, to)) {
          const amount = quotation(c.payOneBond);
          events.push({
            instrumentId: inst.id,
            kind: 'coupon',
            recordDate: day(c.fixDate),
            payDate: day(c.couponDate)!,
            amountPerUnit: amount.toString(),
            currency: currencyOf(c.payOneBond) || inst.currency,
            source: 'tinvest',
            // A floating coupon is known only after its fixing date.
            isEstimate:
              amount.isZero() ||
              (c.couponType === 'COUPON_TYPE_FLOATING' && (c.fixDate ?? c.couponDate) > now),
          });
        }
        const maturity = inst.meta?.maturityDate;
        const nominal = inst.meta?.nominal;
        if (
          typeof maturity === 'string' &&
          typeof nominal === 'string' &&
          maturity >= day(from)! &&
          maturity <= day(to)! &&
          new Decimal(nominal).gt(0)
        ) {
          events.push({
            instrumentId: inst.id,
            kind: 'redemption',
            payDate: maturity,
            amountPerUnit: nominal,
            currency: inst.currency,
            source: 'tinvest',
          });
        }
      } else {
        for (const d of await client.getDividends(inst.externalUid, from, to)) {
          if (!d.paymentDate || d.paymentDate.getTime() <= 0 || d.dividendType === 'Cancelled') continue;
          const amount = quotation(d.dividendNet);
          events.push({
            instrumentId: inst.id,
            kind: 'dividend',
            recordDate: day(d.recordDate),
            payDate: day(d.paymentDate)!,
            amountPerUnit: amount.toString(),
            currency: currencyOf(d.dividendNet) || inst.currency,
            source: 'tinvest',
            isEstimate: amount.isZero(),
          });
        }
      }
    } catch (err) {
      if (err instanceof TinvestError && err.code === 'NOT_FOUND') continue;
      log.warn({ instrumentId: inst.id, err }, 'Payout schedule failed');
      continue;
    }
    upsert(db, events);
    count += events.length;
  }
  return count;
}

export const refreshPayoutsJob = defineJob({
  name: PAYOUTS_JOB,
  lane: 'slow',
  payload: z.null(),
  async handler({ db, log }) {
    const client = tinvestForPrices(db);
    if (!client) return;
    const n = await refreshPayouts(db, client, log);
    log.info({ events: n }, 'Payout schedules refreshed');
  },
});
