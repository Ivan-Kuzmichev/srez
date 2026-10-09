import { and, gt, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { instruments, payoutEvents } from '@/db/schema';
import { bondArea, bondMetrics, type BondFlow } from '@/domain/bonds';
import { Decimal } from '@/domain/decimal';
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
import type { Settings } from './settings';

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

export interface BondRow {
  instrumentId: string;
  name: string;
  quantity: Decimal;
  /** Clean price, percent of the nominal. */
  pricePct: Decimal | null;
  value: Decimal;
  floating: boolean;
  /** Annual coupon, percent of the nominal. */
  couponPct: Decimal | null;
  ytm: Decimal | null;
  duration: Decimal | null;
  modified: Decimal | null;
  approx: boolean;
  /** No coupon schedule known: kept out of the yield and duration. */
  noSchedule: boolean;
  maturityDate: string | null;
  portfolios: string[];
}

export interface BondsData {
  rows: BondRow[];
  value: Decimal;
  /** Bonds in the area's value, percent. */
  capitalShare: Decimal;
  ytm: Decimal | null;
  duration: Decimal | null;
  /** Price change for +1 p.p.; −1 p.p. is the opposite. */
  shock: Decimal;
  couponsYear: Decimal;
  couponsApprox: boolean;
  /** Nominal paid back, rubles, by year. */
  redemptions: { year: string; amount: Decimal }[];
  /** Redemptions, offers and amortizations in the next 12 months. */
  soon: { date: string; name: string; kind: string; amount: Decimal }[];
  floatingShare: Decimal;
}

/** «Облигации» (FR-ANL-6, 7) of the selected portfolio or of everything. */
export function bondsData(
  db: Db,
  userId: string,
  portfolio: PortfolioRow | null,
  settings: Settings,
  now = new Date(),
): BondsData {
  const today = localDate(now, settings.display.timezone);
  const fx = loadFx(db);
  const scope: Scope = portfolio ? portfolioScope(portfolio) : everything;
  const cells = loadValuedCells(db, userId, fx).filter((c) => scope(c.accountId, c.tagId));
  const areaValue = cells
    .filter((c) => settings.returns.includeCash || !c.isCash)
    .reduce((s, c) => s.plus(c.valueRub), ZERO);
  const portfolios = listPortfolios(db, userId).map((p) => ({ name: p.name, scope: portfolioScope(p) }));

  const held = new Map<
    string,
    { quantity: Decimal; value: Decimal; priceRub: Decimal | null; cells: typeof cells }
  >();
  for (const c of cells) {
    if (c.kind !== 'bond' || c.quantity.lte(0)) continue;
    const h = held.get(c.instrumentId) ?? { quantity: ZERO, value: ZERO, priceRub: c.priceRub, cells: [] };
    h.quantity = h.quantity.plus(c.quantity);
    h.value = h.value.plus(c.valueRub);
    h.cells.push(c);
    held.set(c.instrumentId, h);
  }
  const ids = [...held.keys()];
  const info = new Map(
    ids.length
      ? db
          .select({
            id: instruments.id,
            name: instruments.name,
            currency: instruments.currency,
            meta: instruments.meta,
          })
          .from(instruments)
          .where(inArray(instruments.id, ids))
          .all()
          .map((i) => [i.id, i])
      : [],
  );
  const events = ids.length
    ? db
        .select()
        .from(payoutEvents)
        .where(and(inArray(payoutEvents.instrumentId, ids), gt(payoutEvents.payDate, addDays(today, -400))))
        .all()
    : [];

  const yearEnd = addDays(today, 365);
  const rows: BondRow[] = [];
  let couponsYear = ZERO;
  let couponsApprox = false;
  const redemptions = new Map<string, Decimal>();
  const soon: BondsData['soon'] = [];
  let floatingValue = ZERO;

  for (const [id, h] of held) {
    const inst = info.get(id)!;
    const meta = inst.meta ?? {};
    const rate = rubPer(fx, inst.currency) ?? ONE;
    const nominal = typeof meta.nominal === 'string' ? new Decimal(meta.nominal) : null;
    const floating = meta.couponType === 'floating';
    const mine = events
      .filter((e) => e.instrumentId === id)
      .sort((a, b) => a.payDate.localeCompare(b.payDate));
    const known = mine.filter(
      (e) => e.kind === 'coupon' && !e.isEstimate && new Decimal(e.amountPerUnit).gt(0),
    );
    // The next fixed coupon, else the last one paid: a step-up bond's 2041 coupon is not today's.
    const current = known.find((e) => e.payDate > today) ?? known.at(-1);
    const currentCoupon = current ? new Decimal(current.amountPerUnit) : null;
    const future = mine.filter((e) => e.payDate > today);
    const maturity = typeof meta.maturityDate === 'string' ? meta.maturityDate : null;
    const flows: BondFlow[] = future
      .filter((e) => e.kind === 'coupon' || e.kind === 'redemption' || e.kind === 'amortization')
      .map((e) => ({
        date: e.payDate,
        amount: new Decimal(e.amountPerUnit),
        estimate: e.kind === 'coupon' && e.isEstimate,
      }));
    if (!future.some((e) => e.kind === 'redemption') && maturity && nominal && maturity > today)
      flows.push({ date: maturity, amount: nominal });
    const noSchedule = !future.some((e) => e.kind === 'coupon');
    // Prices are rubles per bond; the schedule is in the bond's currency.
    const cleanPrice = h.priceRub ? h.priceRub.div(rate) : null;
    const aci = typeof meta.aci === 'string' ? new Decimal(meta.aci) : ZERO;
    const m =
      noSchedule || !cleanPrice
        ? { ytm: null, duration: null, modified: null, approx: false }
        : bondMetrics({ today, cleanPrice, aci, flows, floating, currentCoupon });

    for (const e of future) {
      const perUnit =
        e.kind === 'coupon' && e.isEstimate && currentCoupon ? currentCoupon : new Decimal(e.amountPerUnit);
      const amount = perUnit.times(h.quantity).times(rate);
      if (e.kind === 'coupon' && e.payDate <= yearEnd) {
        couponsYear = couponsYear.plus(amount);
        if (e.isEstimate) couponsApprox = true;
      }
      if (e.kind !== 'coupon' && e.kind !== 'dividend' && e.payDate <= yearEnd)
        soon.push({ date: e.payDate, name: inst.name, kind: e.kind, amount });
    }
    const redemption = future.find((e) => e.kind === 'redemption');
    const redeemDate = redemption?.payDate ?? maturity;
    const redeemPerUnit = redemption ? new Decimal(redemption.amountPerUnit) : nominal;
    if (redeemDate && redeemPerUnit && redeemDate > today) {
      const y = redeemDate.slice(0, 4);
      redemptions.set(y, (redemptions.get(y) ?? ZERO).plus(redeemPerUnit.times(h.quantity).times(rate)));
    }
    if (floating) floatingValue = floatingValue.plus(h.value);

    rows.push({
      instrumentId: id,
      name: inst.name,
      quantity: h.quantity,
      pricePct: cleanPrice && nominal && nominal.gt(0) ? cleanPrice.div(nominal).times(100) : null,
      value: h.value,
      floating,
      couponPct:
        !floating && currentCoupon && nominal && nominal.gt(0) && typeof meta.couponsPerYear === 'number'
          ? currentCoupon.times(meta.couponsPerYear).div(nominal).times(100)
          : null,
      ...m,
      noSchedule,
      maturityDate: maturity,
      portfolios: portfolios
        .filter((p) => h.cells.some((c) => p.scope(c.accountId, c.tagId)))
        .map((p) => p.name),
    });
  }

  rows.sort((a, b) => b.value.comparedTo(a.value));
  const area = bondArea(rows, new Decimal('0.01'));
  return {
    rows,
    value: area.value,
    capitalShare: areaValue.isZero() ? ZERO : area.value.div(areaValue).times(100),
    ytm: area.ytm,
    duration: area.duration,
    shock: area.shock,
    couponsYear,
    couponsApprox: couponsApprox || rows.some((r) => r.floating),
    redemptions: [...redemptions]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, amount]) => ({ year, amount })),
    soon: soon.sort((a, b) => a.date.localeCompare(b.date)),
    floatingShare: area.value.isZero() ? ZERO : floatingValue.div(area.value).times(100),
  };
}
