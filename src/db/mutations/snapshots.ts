import { and, between, eq, gt, inArray, lt, max, or } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { finAccounts, instruments, positionSnapshots, snapshotTotals } from '@/db/schema';
import { Decimal, toDbDecimal } from '@/domain/decimal';
import { dailyQuantities, valueOn } from '@/domain/timeline';
import { eachDay, localDate } from '@/lib/time';
import { loadFxSeries, loadPriceSeries } from './market';
import { loadAccountLedger } from './positions';

const ZERO = new Decimal(0);

const ONE = new Decimal(1);
/** Rows per INSERT: 11 columns × 500 stays far below SQLite's limit of bound variables. */
const CHUNK = 500;
/** Rows a single write transaction swaps: short enough that the web's writes never wait long. */
const WINDOW_ROWS = 2000;

type SnapshotRow = typeof positionSnapshots.$inferInsert;
type TotalRow = typeof snapshotTotals.$inferInsert;

/**
 * Rewrites the end-of-day values of one account from its first operation through `through`
 * (docs/02-architecture.md, «Ежедневный снимок»). A cell is valued at the market close of the day;
 * without one, at its latest trade price, flagged `approx`. Values convert to rubles at the CBR rate
 * of the same day or the last earlier one.
 *
 * Everything is worked out before writing, and the rows are swapped a window of days at a time, each
 * window its own short transaction. Years of days take seconds on a NAS: one write lock that long made
 * the web's writes fail with «database is locked». While the windows go in, a chart may briefly mix old
 * and new days; a journal change in between queues another rebuild, so a stale result does not stay.
 */
export function rebuildAccountSnapshots(
  db: Executor,
  accountId: string,
  through: string,
  timeZone: string,
): number {
  const { dates, snapshots, totals } = snapshotRows(db, accountId, through, timeZone);
  const mine = (table: typeof positionSnapshots | typeof snapshotTotals) => eq(table.accountId, accountId);
  // Days outside the new range (the journal now starts later, or nothing is left) go first.
  db.transaction((tx) => {
    for (const table of [positionSnapshots, snapshotTotals]) {
      const outside =
        dates.length === 0
          ? mine(table)
          : and(mine(table), or(lt(table.date, dates[0]!), gt(table.date, dates.at(-1)!)));
      tx.delete(table).where(outside).run();
    }
  });
  let s = 0;
  let t = 0;
  for (let d = 0; d < dates.length;) {
    // A window: whole days, about WINDOW_ROWS rows of snapshots.
    const from = dates[d]!;
    const start = s;
    while (d < dates.length && s - start < WINDOW_ROWS) {
      const day = dates[d]!;
      while (snapshots[s]?.date === day) s++;
      d++;
    }
    const to = dates[d - 1]!;
    const tStart = t;
    while (totals[t] && totals[t]!.date <= to) t++;
    db.transaction((tx) => {
      for (const table of [positionSnapshots, snapshotTotals])
        tx.delete(table)
          .where(and(mine(table), between(table.date, from, to)))
          .run();
      for (let i = start; i < s; i += CHUNK)
        tx.insert(positionSnapshots)
          .values(snapshots.slice(i, Math.min(i + CHUNK, s)))
          .run();
      for (let i = tStart; i < t; i += CHUNK)
        tx.insert(snapshotTotals)
          .values(totals.slice(i, Math.min(i + CHUNK, t)))
          .run();
    });
  }
  return snapshots.length;
}

/** The rows of `rebuildAccountSnapshots`, read and computed without a write lock. */
function snapshotRows(
  db: Executor,
  accountId: string,
  through: string,
  timeZone: string,
): { dates: string[]; snapshots: SnapshotRow[]; totals: TotalRow[] } {
  const snapshots: SnapshotRow[] = [];
  const dayTotals: TotalRow[] = [];
  const result = { dates: [] as string[], snapshots, totals: dayTotals };
  const account = db.select().from(finAccounts).where(eq(finAccounts.id, accountId)).get();
  if (!account) return result;
  const { ops, ctx } = loadAccountLedger(db, account);
  const live = ops.filter((o) => !o.voided);
  if (live.length === 0) return result;

  const dayOf = (d: Date) => localDate(d, timeZone);
  const first = live.reduce((m, o) => (o.executedAt < m ? o.executedAt : m), live[0]!.executedAt);
  const dates = eachDay(dayOf(first), through);
  if (dates.length === 0) return result;
  result.dates = dates;
  const timeline = dailyQuantities(live, ctx, dates, dayOf);

  const instrumentIds = [...new Set([...timeline.values()].flat().map((c) => c.instrumentId))];
  const meta = new Map(
    db
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
  const priceSeries = loadPriceSeries(db, instrumentIds);
  const currencies = new Set<string>();
  for (const i of meta.values())
    currencies.add(i.kind === 'currency' ? (i.ticker ?? i.currency) : i.currency);
  for (const o of live) currencies.add(o.currency);
  const fx = loadFxSeries(db, [...currencies]);
  const rubPer = (code: string, date: string): Decimal | null => {
    if (code === 'RUB') return ONE;
    const series = fx.get(code) ?? [];
    const point = valueOn(series, date) ?? series[0] ?? null;
    return point ? new Decimal(point.rate) : null;
  };

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
      snapshots.push({
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
      });
    }
    for (const t of totals.values())
      dayTotals.push({
        userId: account.userId,
        date,
        accountId,
        tagId: t.tagId,
        valueRub: toDbDecimal(t.value),
        cashRub: toDbDecimal(t.cash),
      });
  }
  return result;
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
