import { and, eq, inArray, max } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { finAccounts, instruments, positionSnapshots, snapshotTotals } from '@/db/schema';
import { Decimal, toDbDecimal } from '@/domain/decimal';
import { dailyQuantities, valueOn } from '@/domain/timeline';
import { eachDay, localDate } from '@/lib/time';
import { loadFxSeries, loadPriceSeries } from './market';
import { loadAccountLedger } from './positions';

const ZERO = new Decimal(0);

const ONE = new Decimal(1);

/**
 * Rewrites the end-of-day values of one account from its first operation through `through`
 * (docs/02-architecture.md, «Ежедневный снимок»). A cell is valued at the market close of the day;
 * without one, at its latest trade price, flagged `approx`. Values convert to rubles at the CBR rate
 * of the same day or the last earlier one.
 */
export function rebuildAccountSnapshots(
  db: Executor,
  accountId: string,
  through: string,
  timeZone: string,
): number {
  return db.transaction((tx) => {
    const account = tx.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get();
    tx.delete(positionSnapshots).where(eq(positionSnapshots.accountId, accountId)).run();
    tx.delete(snapshotTotals).where(eq(snapshotTotals.accountId, accountId)).run();
    if (!account) return 0;
    const { ops, ctx } = loadAccountLedger(tx, account);
    const live = ops.filter((o) => !o.voided);
    if (live.length === 0) return 0;

    const dayOf = (d: Date) => localDate(d, timeZone);
    const first = live.reduce((m, o) => (o.executedAt < m ? o.executedAt : m), live[0]!.executedAt);
    const dates = eachDay(dayOf(first), through);
    if (dates.length === 0) return 0;
    const timeline = dailyQuantities(live, ctx, dates, dayOf);

    const instrumentIds = [...new Set([...timeline.values()].flat().map((c) => c.instrumentId))];
    const meta = new Map(
      tx
        .select({
          id: instruments.id,
          kind: instruments.kind,
          ticker: instruments.ticker,
          currency: instruments.currency,
        })
        .from(instruments)
        .where(inArray(instruments.id, instrumentIds.length ? instrumentIds : ['']))
        .all()
        .map((i) => [i.id, i]),
    );
    const priceSeries = loadPriceSeries(tx, instrumentIds);
    const currencies = new Set<string>();
    for (const i of meta.values())
      currencies.add(i.kind === 'currency' ? (i.ticker ?? i.currency) : i.currency);
    for (const o of live) currencies.add(o.currency);
    const fx = loadFxSeries(tx, [...currencies]);
    const rubPer = (code: string, date: string): Decimal | null => {
      if (code === 'RUB') return ONE;
      const series = fx.get(code) ?? [];
      const point = valueOn(series, date) ?? series[0] ?? null;
      return point ? new Decimal(point.rate) : null;
    };

    let written = 0;
    for (const date of dates) {
      const totals = new Map<string, { tagId: string | null; value: Decimal; cash: Decimal }>();
      for (const c of timeline.get(date) ?? []) {
        const inst = meta.get(c.instrumentId);
        if (!inst) continue;
        let currency: string;
        let price: Decimal;
        let approx = false;
        if (inst.kind === 'currency') {
          currency = inst.ticker ?? inst.currency;
          price = ONE;
        } else {
          const point = valueOn(priceSeries.get(c.instrumentId) ?? [], date);
          if (point) {
            currency = point.currency;
            price = new Decimal(point.close);
          } else {
            currency = c.lastTradeCurrency ?? inst.currency;
            price = c.lastTradePrice ?? new Decimal(0);
            approx = true;
          }
        }
        const value = c.quantity.times(price);
        const rate = rubPer(currency, date);
        const valueRub = rate ? value.times(rate) : value;
        const cell = totals.get(c.tagId ?? '') ?? { tagId: c.tagId, value: ZERO, cash: ZERO };
        cell.value = cell.value.plus(valueRub);
        if (inst.kind === 'currency') cell.cash = cell.cash.plus(valueRub);
        totals.set(c.tagId ?? '', cell);
        tx.insert(positionSnapshots)
          .values({
            userId: account.userId,
            date,
            accountId,
            instrumentId: c.instrumentId,
            tagId: c.tagId,
            quantity: toDbDecimal(c.quantity),
            price: toDbDecimal(price),
            currency,
            value: toDbDecimal(value),
            valueRub: toDbDecimal(valueRub),
            approx: approx || !rate,
          })
          .run();
        written += 1;
      }
      for (const t of totals.values())
        tx.insert(snapshotTotals)
          .values({
            userId: account.userId,
            date,
            accountId,
            tagId: t.tagId,
            valueRub: toDbDecimal(t.value),
            cashRub: toDbDecimal(t.cash),
          })
          .run();
    }
    return written;
  });
}

/** Last snapshot date per account, to find accounts that are behind. */
/**
 * The last day each account is rebuilt through, read from the totals: an account with snapshots but
 * no totals (a database from before migration 0019) counts as behind and is rebuilt by the daily job.
 */
export function lastSnapshotDates(db: Executor, accountIds: string[]): Map<string, string | null> {
  const rows = db
    .select({ accountId: snapshotTotals.accountId, last: max(snapshotTotals.date) })
    .from(snapshotTotals)
    .where(inArray(snapshotTotals.accountId, accountIds.length ? accountIds : ['']))
    .groupBy(snapshotTotals.accountId)
    .all();
  const out = new Map<string, string | null>(accountIds.map((id) => [id, null]));
  for (const r of rows) out.set(r.accountId, r.last);
  return out;
}

export function deleteAccountSnapshots(db: Executor, accountId: string): void {
  db.delete(positionSnapshots)
    .where(and(eq(positionSnapshots.accountId, accountId)))
    .run();
  db.delete(snapshotTotals).where(eq(snapshotTotals.accountId, accountId)).run();
}
