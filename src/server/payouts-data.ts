import { and, asc, desc, eq, gt, inArray, lt, lte } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, instruments, operations, payoutEvents } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { heldQuantity } from '@/domain/holdings';
import type { OperationType } from '@/domain/ledger-types';
import { interestDates, monthlyInterest, yearForecast } from '@/domain/payouts';
import { everything, type Scope } from '@/domain/scope';
import { addDays, localDate } from '@/lib/time';
import {
  listPortfolios,
  loadFx,
  loadValuedCells,
  portfolioScope,
  rubPer,
  type PortfolioRow,
} from './portfolio-data';
import { getSettings } from './settings';

const ZERO = new Decimal(0);
const PAYOUT_TYPES: OperationType[] = ['dividend', 'coupon', 'interest'];

export interface PayoutRow {
  date: string;
  instrumentId: string | null;
  name: string;
  kind: 'dividend' | 'coupon' | 'interest' | 'redemption' | 'amortization' | 'offer';
  /** «900 × 35,40»: quantity and per unit, when known. */
  quantity: Decimal | null;
  perUnit: Decimal | null;
  currency: string;
  amountRub: Decimal;
  account: string;
  estimate: boolean;
}

export interface PayoutsView {
  year: number;
  years: number[];
  portfolio: PortfolioRow | null;
  portfolios: { id: string; name: string }[];
  received: Decimal;
  expected: Decimal;
  expectedCount: number;
  nearest: string | null;
  forecast: Decimal;
  perMonth: Decimal;
  /** January to December, rubles. */
  months: { received: Decimal; expected: Decimal }[];
  upcoming: PayoutRow[];
  recent: PayoutRow[];
  currentYear: boolean;
}

/** «Выплаты» (FR-PAY-1…4, 6; docs/04-calculations.md, section 9). */
export function payoutsView(
  db: Db,
  userId: string,
  year: number | undefined,
  portfolioId?: string,
  now = new Date(),
): PayoutsView {
  const tz = getSettings(db, userId).display.timezone;
  const today = localDate(now, tz);
  const thisYear = Number(today.slice(0, 4));
  const all = listPortfolios(db, userId);
  const portfolio = all.find((p) => p.id === portfolioId) ?? null;
  const scope: Scope = portfolio ? portfolioScope(portfolio) : everything;
  const fx = loadFx(db);
  const accounts = new Map(
    db
      .select({ id: finAccounts.id, name: finAccounts.name, defaultTagId: finAccounts.defaultTagId })
      .from(finAccounts)
      .where(eq(finAccounts.userId, userId))
      .all()
      .map((a) => [a.id, a]),
  );
  const inScope = (o: { accountId: string; tagId: string | null }) =>
    scope(o.accountId, o.tagId ?? accounts.get(o.accountId)?.defaultTagId ?? null);

  const payoutOps = db
    .select({
      id: operations.id,
      accountId: operations.accountId,
      tagId: operations.tagId,
      instrumentId: operations.instrumentId,
      name: instruments.name,
      type: operations.type,
      at: operations.executedAt,
      amount: operations.amount,
      currency: operations.currency,
    })
    .from(operations)
    .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
    .where(and(eq(operations.userId, userId), inArray(operations.type, PAYOUT_TYPES)))
    .orderBy(desc(operations.executedAt))
    .all()
    .filter(inScope);
  const years = [
    ...new Set([thisYear, ...payoutOps.map((o) => Number(localDate(o.at, tz).slice(0, 4)))]),
  ].sort((a, b) => b - a);
  const y = year && years.includes(year) ? year : thisYear;
  const toRow = (o: (typeof payoutOps)[number]): PayoutRow => {
    const date = localDate(o.at, tz);
    return {
      date,
      instrumentId: o.instrumentId,
      name: o.name ?? '',
      kind: o.type as PayoutRow['kind'],
      quantity: null,
      perUnit: null,
      currency: o.currency,
      amountRub: new Decimal(o.amount).times(rubPer(fx, o.currency, date) ?? 1),
      account: accounts.get(o.accountId)?.name ?? '',
      estimate: false,
    };
  };
  const months = Array.from({ length: 12 }, () => ({ received: ZERO, expected: ZERO }));
  let received = ZERO;
  for (const o of payoutOps) {
    const r = toRow(o);
    if (Number(r.date.slice(0, 4)) !== y) continue;
    received = received.plus(r.amountRub);
    const m = Number(r.date.slice(5, 7)) - 1;
    months[m]!.received = months[m]!.received.plus(r.amountRub);
  }

  // Expected: only for the current year, from tomorrow to 31 December.
  const upcoming: PayoutRow[] = [];
  if (y === thisYear) {
    const end = `${y}-12-31`;
    const cells = loadValuedCells(db, userId, fx).filter(
      (c) => !c.isCash && c.quantity.gt(0) && scope(c.accountId, c.tagId),
    );
    const byInstrument = new Map<string, typeof cells>();
    for (const c of cells) byInstrument.set(c.instrumentId, [...(byInstrument.get(c.instrumentId) ?? []), c]);
    const events = byInstrument.size
      ? db
          .select()
          .from(payoutEvents)
          .where(
            and(
              inArray(payoutEvents.instrumentId, [...byInstrument.keys()]),
              gt(payoutEvents.payDate, today),
              lte(payoutEvents.payDate, end),
            ),
          )
          .orderBy(asc(payoutEvents.payDate))
          .all()
      : [];
    for (const e of events) {
      const own = byInstrument.get(e.instrumentId)!;
      // Past the record date the payout belongs to what was held then.
      let quantity = own.reduce((s, c) => s.plus(c.quantity), ZERO);
      if (e.recordDate && e.recordDate <= today) {
        const before = db
          .select({
            type: operations.type,
            quantity: operations.quantity,
            accountId: operations.accountId,
            tagId: operations.tagId,
          })
          .from(operations)
          .where(
            and(
              eq(operations.instrumentId, e.instrumentId),
              lt(operations.executedAt, new Date(`${addDays(e.recordDate, 1)}T00:00:00Z`)),
            ),
          )
          .orderBy(asc(operations.executedAt))
          .all()
          .filter(inScope);
        quantity = heldQuantity(before.map((o) => ({ type: o.type, quantity: new Decimal(o.quantity) })));
      }
      if (quantity.lte(0)) continue;
      const per = new Decimal(e.amountPerUnit);
      upcoming.push({
        date: e.payDate,
        instrumentId: e.instrumentId,
        name: own[0]!.name,
        kind: e.kind,
        quantity,
        perUnit: per,
        currency: e.currency,
        amountRub: per.times(quantity).times(rubPer(fx, e.currency) ?? 1),
        account: [...new Set(own.map((c) => c.accountName))].join(', '),
        estimate: e.isEstimate,
      });
    }
    // Custom assets at an annual rate: the coming monthly interest (FR-PAY-6).
    const custom = cells.filter((c) => c.kind === 'custom');
    if (custom.length) {
      const meta = new Map(
        db
          .select({ id: instruments.id, meta: instruments.meta })
          .from(instruments)
          .where(
            inArray(
              instruments.id,
              custom.map((c) => c.instrumentId),
            ),
          )
          .all()
          .map((i) => [i.id, i.meta]),
      );
      for (const c of custom) {
        const m = meta.get(c.instrumentId);
        if (m?.valuation !== 'interest' || typeof m.annualRate !== 'string' || !c.costRub) continue;
        const first = db
          .select({ at: operations.executedAt })
          .from(operations)
          .where(and(eq(operations.accountId, c.accountId), eq(operations.instrumentId, c.instrumentId)))
          .orderBy(asc(operations.executedAt))
          .get();
        if (!first) continue;
        const amount = monthlyInterest(c.costRub, new Decimal(m.annualRate)).toDecimalPlaces(2);
        for (const date of interestDates(localDate(first.at, tz), addDays(today, 1), end))
          upcoming.push({
            date,
            instrumentId: c.instrumentId,
            name: c.name,
            kind: 'interest',
            quantity: null,
            perUnit: null,
            currency: 'RUB',
            amountRub: amount,
            account: c.accountName,
            estimate: false,
          });
      }
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    for (const u of upcoming) {
      const m = Number(u.date.slice(5, 7)) - 1;
      months[m]!.expected = months[m]!.expected.plus(u.amountRub);
    }
  }
  const expected = upcoming.reduce((s, u) => s.plus(u.amountRub), ZERO);
  const { forecast, perMonth } = yearForecast(received, expected);
  return {
    year: y,
    years,
    portfolio,
    portfolios: all.map((p) => ({ id: p.id, name: p.name })),
    received,
    expected,
    expectedCount: upcoming.length,
    nearest: upcoming[0]?.date ?? null,
    forecast,
    perMonth,
    months,
    upcoming,
    recent: payoutOps
      .filter((o) => localDate(o.at, tz) <= today)
      .slice(0, 10)
      .map(toRow),
    currentYear: y === thisYear,
  };
}
