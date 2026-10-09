import { and, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { instruments, operations, prices, pricesLast, sources } from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { isoWeek, type Condition } from '@/domain/notify';
import { everything } from '@/domain/scope';
import { addDays, localDate } from '@/lib/time';
import { formatChange, formatMoney, formatPercent, formatPp } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import {
  listPortfolios,
  loadFx,
  loadUserLedger,
  loadValuedCells,
  portfolioScope,
  rubPer,
  summarizeArea,
  valueSeries,
} from './portfolio-data';
import { riskData } from './risk-data';
import type { Settings } from './settings';

const PAYOUTS = ['dividend', 'coupon', 'interest'] as const;
const DAY = 86_400_000;
const m = ru.notify.messages;

/**
 * Everything that is true right now and worth a message (FR-NTF-2). Keys are stable while the
 * condition holds; the caller sends what became true and forgets what stopped being true.
 */
export function currentConditions(db: Db, userId: string, settings: Settings, now = new Date()): Condition[] {
  const tz = settings.display.timezone;
  const masked = settings.logging.maskAmounts;
  const rub = (v: Decimal) => (masked ? null : formatMoney(Money.of(v.round(), 'RUB')));
  const out: Condition[] = [];
  const fx = loadFx(db);

  if (settings.notify.events.payout) {
    // What a sync brought in during the last two days (a manual entry is no news to its author).
    const rows = db
      .select({
        id: operations.id,
        type: operations.type,
        amount: operations.amount,
        currency: operations.currency,
        at: operations.executedAt,
        name: instruments.name,
      })
      .from(operations)
      .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
      .where(
        and(
          eq(operations.userId, userId),
          inArray(operations.type, [...PAYOUTS]),
          ne(operations.origin, 'manual'),
          gte(operations.createdAt, new Date(now.getTime() - 2 * DAY)),
          gte(operations.executedAt, new Date(now.getTime() - 7 * DAY)),
        ),
      )
      .all();
    for (const r of rows) {
      const amountRub = new Decimal(r.amount).times(rubPer(fx, r.currency, localDate(r.at, tz)) ?? 1);
      out.push({
        key: `payout:${r.id}`,
        text: m.payout(
          ru.journal.types[r.type] ?? r.type,
          r.name ?? '',
          masked ? null : formatChange(Money.of(amountRub.round(), 'RUB')),
        ),
      });
    }
  }

  if (settings.notify.events.syncError)
    for (const s of db
      .select()
      .from(sources)
      .where(and(eq(sources.userId, userId), eq(sources.status, 'error')))
      .all())
      out.push({ key: `sync:${s.id}`, text: m.syncError(s.name, s.lastError) });

  const cells = loadValuedCells(db, userId, fx);
  const ledger = loadUserLedger(db, userId);
  const threshold = new Decimal(settings.notify.thresholds.deviationPp);
  const portfolios = listPortfolios(db, userId);
  for (const p of portfolios) {
    if (!p.targetsEnabled || p.targets.size === 0) continue;
    const s = summarizeArea(
      db,
      userId,
      portfolioScope(p),
      cells,
      ledger,
      fx,
      tz,
      { values: p.targets, threshold },
      now,
    );
    for (const c of s.classes)
      if (c.deviation && c.target !== null && c.deviation.abs().gte(threshold))
        out.push({
          key: `deviation:${p.id}:${c.assetClass}`,
          text: m.deviation(
            p.name,
            ru.classesShort[c.assetClass] ?? c.assetClass,
            formatPercent(c.share.toFixed(1)),
            formatPercent(c.target.toFixed(0), { digits: 0 }),
            formatPp(c.deviation),
          ),
        });
  }

  // A security's move today: the live price against the last close before today.
  const today = localDate(now, tz);
  const held = [
    ...new Map(cells.filter((c) => !c.isCash && c.quantity.gt(0)).map((c) => [c.instrumentId, c])).values(),
  ];
  const move = new Decimal(settings.notify.thresholds.dayMovePct);
  for (const c of held) {
    const last = db
      .select({ price: pricesLast.price })
      .from(pricesLast)
      .where(eq(pricesLast.instrumentId, c.instrumentId))
      .get();
    const prev = db
      .select({ close: prices.close })
      .from(prices)
      .where(and(eq(prices.instrumentId, c.instrumentId), lt(prices.date, today)))
      .orderBy(desc(prices.date))
      .get();
    if (!last || !prev || new Decimal(prev.close).lte(0)) continue;
    const pct = new Decimal(last.price).div(prev.close).minus(1).times(100);
    if (pct.abs().gte(move))
      out.push({
        key: `move:${c.instrumentId}`,
        text: m.dayMove(
          c.ticker && c.kind !== 'bond' ? `${c.ticker} ${c.name}` : c.name,
          formatPercent(pct.toFixed(1), { signed: true }),
        ),
      });
  }

  if (settings.limits.notify) {
    const l = riskData(db, userId, null, settings, now).limits;
    const pct = (v: Decimal) => formatPercent(v.toFixed(1));
    if (l.issuer.exceeded)
      out.push({
        key: `limit:issuer:${l.issuer.name}`,
        text: m.limitIssuer(l.issuer.name ?? '', pct(l.issuer.share), pct(l.issuer.limit)),
      });
    if (l.singleStock.exceeded)
      out.push({
        key: `limit:singleStock:${l.singleStock.name}`,
        text: m.limitStock(l.singleStock.name ?? '', pct(l.singleStock.share), pct(l.singleStock.limit)),
      });
    if (l.crypto.exceeded)
      out.push({ key: 'limit:crypto', text: m.limitCrypto(pct(l.crypto.share), pct(l.crypto.limit)) });
  }

  // Monday from 10:00 local time, once a week.
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  if (settings.notify.events.weekly && local.getDay() === 1 && local.getHours() >= 10)
    out.push({ key: `weekly:${isoWeek(today)}`, text: weeklySummary(db, userId, settings, now, rub) });

  return out;
}

function weeklySummary(
  db: Db,
  userId: string,
  settings: Settings,
  now: Date,
  rub: (v: Decimal) => string | null,
): string {
  const tz = settings.display.timezone;
  const fx = loadFx(db);
  const cells = loadValuedCells(db, userId, fx);
  const ledger = loadUserLedger(db, userId);
  const weekAgo = addDays(localDate(now, tz), -7);
  const lines: string[] = [];
  for (const [name, scope] of [
    [m.everything, everything] as const,
    ...listPortfolios(db, userId).map((p) => [p.name, portfolioScope(p)] as const),
  ]) {
    const s = summarizeArea(db, userId, scope, cells, ledger, fx, tz, null, now);
    const then = valueSeries(db, userId, scope, weekAgo).find((p) => p.date >= weekAgo)?.value;
    const change = then && then.gt(0) ? s.value.div(then).minus(1).times(100) : null;
    lines.push(
      m.weeklyLine(name, rub(s.value), change ? formatPercent(change.toFixed(1), { signed: true }) : null),
    );
  }
  const payouts = db
    .select({ amount: operations.amount, currency: operations.currency, at: operations.executedAt })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        inArray(operations.type, [...PAYOUTS]),
        gte(operations.executedAt, new Date(now.getTime() - 7 * DAY)),
      ),
    )
    .all()
    .reduce(
      (s, o) => s.plus(new Decimal(o.amount).times(rubPer(fx, o.currency, localDate(o.at, tz)) ?? 1)),
      new Decimal(0),
    );
  lines.push(m.weeklyPayouts(rub(payouts)));
  return [m.weeklyTitle, ...lines].join('\n');
}
