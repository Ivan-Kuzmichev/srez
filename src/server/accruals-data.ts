import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, instruments, operations, positions, sources } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import type { Scope } from '@/domain/scope';
import { network, yieldToken } from '@/integrations/chains/networks';
import { localDate } from '@/lib/time';
import { type FxSeries, rubPer } from './portfolio-data';

const ZERO = new Decimal(0);
const BASE: Record<string, string> = { ethereum: 'ETH', 'usd-coin': 'USDC', tether: 'USDT', bitcoin: 'BTC' };
const baseSymbol = (id: string | undefined) => (id ? (BASE[id] ?? id) : '');
const ONE = new Decimal(1);
/** The rate is read from the last 30 days; fewer than 7 days of data give no forecast. */
const WINDOW_DAYS = 30;
const MIN_DAYS = 7;

export interface AccrualRow {
  instrumentId: string;
  protocol: string;
  symbol: string;
  tokenSymbol: string;
  /** The coin accruals are counted in: the token itself, or a wrapper's base coin. */
  unitSymbol: string;
  networks: string[];
  accrues: 'continuous' | 'daily' | 'rate';
  quantity: Decimal;
  month: { units: Decimal; rub: Decimal };
  year: { units: Decimal; rub: Decimal };
  /** Annual rate from recent accruals, a fraction; null while history is short. */
  rate: Decimal | null;
  forecastRub: Decimal | null;
}

/**
 * «Начисления по крипте» (FR-PAY-5): per yield token in the area, what accrued this month and this
 * year in rubles at each day's price, and a forecast at the recent rate. Not part of payouts totals.
 */
export function cryptoAccruals(
  db: Db,
  userId: string,
  scope: Scope,
  fx: FxSeries,
  year: string,
  timeZone: string,
  now = new Date(),
): { rows: AccrualRow[]; totalYearRub: Decimal } {
  const wallets = db
    .select({ id: finAccounts.id, defaultTagId: finAccounts.defaultTagId, meta: finAccounts.meta })
    .from(finAccounts)
    .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
    .where(and(eq(finAccounts.userId, userId), eq(sources.kind, 'wallet')))
    .all();
  const ids = wallets.map((w) => w.id);
  const watched = new Set(
    wallets.flatMap((w) => (w.meta as { wallet?: { networks?: string[] } } | null)?.wallet?.networks ?? []),
  );
  if (ids.length === 0) return { rows: [], totalYearRub: ZERO };
  const inScope = (accountId: string, tagId: string | null) =>
    scope(accountId, tagId ?? wallets.find((w) => w.id === accountId)?.defaultTagId ?? null);

  const held = db
    .select({
      accountId: positions.accountId,
      tagId: positions.tagId,
      instrumentId: positions.instrumentId,
      quantity: positions.quantity,
      meta: instruments.meta,
    })
    .from(positions)
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .where(inArray(positions.accountId, ids))
    .all()
    .filter((p) => inScope(p.accountId, p.tagId));
  const today = localDate(now, timeZone);
  const month = today.slice(0, 7);
  const since = new Date(now.getTime() - Math.max(WINDOW_DAYS, 400) * 86_400_000);
  const accruals = db
    .select({
      accountId: operations.accountId,
      tagId: operations.tagId,
      instrumentId: operations.instrumentId,
      quantity: operations.quantity,
      accruedInterest: operations.accruedInterest,
      price: operations.price,
      currency: operations.currency,
      at: operations.executedAt,
      externalId: operations.externalId,
    })
    .from(operations)
    .where(
      and(
        inArray(operations.accountId, ids),
        eq(operations.type, 'accrual'),
        isNull(operations.voidedAt),
        gte(
          operations.executedAt,
          new Date(Math.min(since.getTime(), Date.parse(`${year}-01-01T00:00:00Z`))),
        ),
      ),
    )
    .all()
    .filter((o) => inScope(o.accountId, o.tagId));

  const byInstrument = new Map<string, { quantity: Decimal; meta: Record<string, unknown> }>();
  for (const p of held) {
    const meta = (p.meta ?? {}) as Record<string, unknown>;
    if (!meta.yieldKind || meta.yieldKind === 'none') continue;
    const cur = byInstrument.get(p.instrumentId);
    byInstrument.set(p.instrumentId, { quantity: (cur?.quantity ?? ZERO).plus(p.quantity), meta });
  }
  // Tokens sold this year still show what they earned.
  for (const o of accruals)
    if (o.instrumentId && !byInstrument.has(o.instrumentId) && localDate(o.at, timeZone).startsWith(year)) {
      const meta =
        db
          .select({ meta: instruments.meta })
          .from(instruments)
          .where(eq(instruments.id, o.instrumentId))
          .get()?.meta ?? {};
      byInstrument.set(o.instrumentId, { quantity: ZERO, meta });
    }

  const rows: AccrualRow[] = [];
  let totalYearRub = ZERO;
  for (const [instrumentId, { quantity, meta }] of byInstrument) {
    const symbol = String(meta.yieldKey ?? '');
    const reg = yieldToken(symbol);
    const mine = accruals.filter((o) => o.instrumentId === instrumentId);
    const units = (o: (typeof mine)[number]) =>
      new Decimal(o.quantity).gt(0) ? new Decimal(o.quantity) : new Decimal(o.accruedInterest);
    const rub = (o: (typeof mine)[number]) =>
      units(o)
        .times(o.price)
        .times(rubPer(fx, o.currency, localDate(o.at, timeZone)) ?? ONE);
    const sum = (list: typeof mine) => ({
      units: list.reduce((s, o) => s.plus(units(o)), ZERO),
      rub: list.reduce((s, o) => s.plus(rub(o)), ZERO),
    });
    const ofYear = mine.filter((o) => localDate(o.at, timeZone).startsWith(year));
    const yearSum = sum(ofYear);
    totalYearRub = totalYearRub.plus(yearSum.rub);

    // The rate: daily accruals of the window (not «before connection») over what is held now.
    const daily = mine.filter(
      (o) => !o.externalId?.endsWith(':before') && now.getTime() - o.at.getTime() <= WINDOW_DAYS * 86_400_000,
    );
    const days = daily.length
      ? Math.max(1, Math.round((now.getTime() - Math.min(...daily.map((o) => o.at.getTime()))) / 86_400_000))
      : 0;
    const wrapped = meta.yieldKind === 'wrapped';
    // A wrapper's accrual is in the base coin; its holding is in wrapper units: compare in rubles.
    const lastPrice = mine.at(-1)?.price;
    const valueRub = lastPrice ? quantity.times(lastPrice).times(rubPer(fx, 'USD') ?? ONE) : null;
    const accruedRub = sum(daily).rub;
    const rate =
      days >= MIN_DAYS && quantity.gt(0) && valueRub && valueRub.gt(0)
        ? (wrapped ? accruedRub.div(valueRub) : sum(daily).units.div(quantity)).times(365).div(days)
        : null;

    rows.push({
      instrumentId,
      protocol: reg?.token.protocol ?? '',
      symbol: reg?.token.displaySymbol ?? symbol,
      tokenSymbol: symbol,
      unitSymbol: wrapped ? baseSymbol(reg?.token.underlyingId) : symbol,
      networks: (reg?.networks ?? []).filter((n) => watched.has(n)).map((n) => network(n).name),
      accrues: reg?.token.accrues ?? 'daily',
      quantity,
      month: sum(ofYear.filter((o) => localDate(o.at, timeZone).startsWith(month))),
      year: yearSum,
      rate,
      forecastRub: rate && valueRub ? valueRub.times(rate) : null,
    });
  }
  return { rows: rows.sort((a, b) => b.year.rub.comparedTo(a.year.rub)), totalYearRub };
}
