import type { AssetClass } from './allocation';
import { Decimal } from './decimal';

/** docs/04-calculations.md, section 11. Everything runs on the TWR index of an area. */
export interface IndexPoint {
  date: string;
  index: Decimal;
}

const ZERO = new Decimal(0);

/** DD_t = I_t / max(I_0..I_t) − 1, per day. */
export function drawdownSeries(points: readonly IndexPoint[]): { date: string; dd: Decimal }[] {
  let peak: Decimal | null = null;
  return points.map((p) => {
    if (peak === null || p.index.gt(peak)) peak = p.index;
    return { date: p.date, dd: peak.isZero() ? ZERO : p.index.div(peak).minus(1) };
  });
}

export interface MaxDrawdown {
  /** Negative, a fraction. */
  depth: Decimal;
  peakDate: string;
  troughDate: string;
  /** First day back at the old peak; null while still below it. */
  recoveryDate: string | null;
  /** Calendar days from the trough to the recovery. */
  recoveryDays: number | null;
}

/** The deepest fall from a running peak; null when the index never fell. */
export function maxDrawdown(points: readonly IndexPoint[]): MaxDrawdown | null {
  const dd = drawdownSeries(points);
  let worst = -1;
  for (let i = 0; i < dd.length; i++)
    if (dd[i]!.dd.lt(0) && (worst < 0 || dd[i]!.dd.lt(dd[worst]!.dd))) worst = i;
  if (worst < 0) return null;
  let peak = worst;
  while (peak > 0 && dd[peak]!.dd.lt(0)) peak--;
  const peakIndex = points[peak]!.index;
  let recovery = -1;
  for (let i = worst + 1; i < points.length; i++)
    if (points[i]!.index.gte(peakIndex)) {
      recovery = i;
      break;
    }
  const troughDate = points[worst]!.date;
  const recoveryDate = recovery < 0 ? null : points[recovery]!.date;
  return {
    depth: dd[worst]!.dd,
    peakDate: points[peak]!.date,
    troughDate,
    recoveryDate,
    recoveryDays: recoveryDate ? daysBetween(troughDate, recoveryDate) : null,
  };
}

/** r_t = I_t / I_{t−1} − 1. */
export function dailyReturns(index: readonly Decimal[]): Decimal[] {
  const out: Decimal[] = [];
  for (let i = 1; i < index.length; i++)
    if (index[i - 1]!.gt(0)) out.push(index[i]!.div(index[i - 1]!).minus(1));
  return out;
}

const mean = (xs: readonly Decimal[]) => xs.reduce((s, x) => s.plus(x), ZERO).div(xs.length);

/** Sample standard deviation of daily returns × √252; null with fewer than two returns. */
export function volatility(returns: readonly Decimal[]): Decimal | null {
  if (returns.length < 2) return null;
  const m = mean(returns);
  const variance = returns.reduce((s, r) => s.plus(r.minus(m).pow(2)), ZERO).div(returns.length - 1);
  return variance.sqrt().times(new Decimal(252).sqrt());
}

/** cov(r_p, r_b) / var(r_b) over days that have both; null when the benchmark does not move. */
export function beta(pairs: readonly { portfolio: Decimal; benchmark: Decimal }[]): Decimal | null {
  if (pairs.length < 2) return null;
  const mp = mean(pairs.map((p) => p.portfolio));
  const mb = mean(pairs.map((p) => p.benchmark));
  let cov = ZERO;
  let varB = ZERO;
  for (const p of pairs) {
    cov = cov.plus(p.portfolio.minus(mp).times(p.benchmark.minus(mb)));
    varB = varB.plus(p.benchmark.minus(mb).pow(2));
  }
  return varB.isZero() ? null : cov.div(varB);
}

/** The calendar month with the lowest return: its last index against the last one before it. */
export function worstMonth(points: readonly IndexPoint[]): { month: string; ret: Decimal } | null {
  let worst: { month: string; ret: Decimal } | null = null;
  let base: Decimal | null = points[0]?.index ?? null;
  for (let i = 0; i < points.length; i++) {
    const month = points[i]!.date.slice(0, 7);
    const last = i === points.length - 1 || points[i + 1]!.date.slice(0, 7) !== month;
    if (!last) continue;
    if (base && base.gt(0)) {
      const ret = points[i]!.index.div(base).minus(1);
      if (!worst || ret.lt(worst.ret)) worst = { month, ret };
    }
    base = points[i]!.index;
  }
  return worst;
}

export interface Holding {
  instrumentId: string;
  ticker: string | null;
  name: string;
  kind: string;
  assetClass: AssetClass;
  currency: string;
  issuer: string | null;
  isCash: boolean;
  /** Rubles. */
  value: Decimal;
}

const shareOf = (v: Decimal, total: Decimal) => (total.isZero() ? ZERO : v.div(total).times(100));

/** The largest securities by value (cash is not a position here), with their shares in percent. */
export function largest(holdings: readonly Holding[], total: Decimal, n = 5) {
  const top = holdings
    .filter((h) => !h.isCash && h.value.gt(0))
    .sort((a, b) => b.value.comparedTo(a.value))
    .slice(0, n)
    .map((h) => ({ ...h, share: shareOf(h.value, total) }));
  return { top, share: top.reduce((s, h) => s.plus(h.share), ZERO) };
}

/** What the risk is denominated in: crypto by coin, everything else by its currency. */
export function riskCurrencies(
  holdings: readonly Holding[],
  total: Decimal,
): { key: string; share: Decimal }[] {
  const by = new Map<string, Decimal>();
  for (const h of holdings) {
    if (h.value.lte(0)) continue;
    const key = h.assetClass === 'crypto' ? (h.ticker ?? h.name) : h.currency;
    by.set(key, (by.get(key) ?? ZERO).plus(h.value));
  }
  return [...by]
    .map(([key, v]) => ({ key, share: shareOf(v, total) }))
    .sort((a, b) => b.share.comparedTo(a.share));
}

export interface Limits {
  issuerPct: number;
  singleStockPct: number;
  cryptoPct: number;
}

export interface LimitCheck {
  limit: Decimal;
  /** The largest share now, percent. */
  share: Decimal;
  /** Who holds it: an issuer or a security; null for the crypto class. */
  name: string | null;
  exceeded: boolean;
}

/** FR-ANL-5: one issuer (by `issuer`, else the security), one share, crypto as a whole. */
export function limitChecks(holdings: readonly Holding[], total: Decimal, limits: Limits) {
  const issuers = new Map<string, { name: string; value: Decimal }>();
  let stock: { name: string; value: Decimal } | null = null;
  let crypto = ZERO;
  for (const h of holdings) {
    if (h.isCash || h.value.lte(0)) continue;
    if (h.assetClass === 'crypto') crypto = crypto.plus(h.value);
    const key = h.issuer ?? h.instrumentId;
    const cur = issuers.get(key);
    issuers.set(key, { name: h.issuer ?? h.name, value: (cur?.value ?? ZERO).plus(h.value) });
    if (h.kind === 'share' && (!stock || h.value.gt(stock.value))) stock = { name: h.name, value: h.value };
  }
  const check = (found: { name: string | null; value: Decimal } | null, limit: number): LimitCheck => {
    const share = found ? shareOf(found.value, total) : ZERO;
    const l = new Decimal(limit);
    return { limit: l, share, name: found?.name ?? null, exceeded: share.gt(l) };
  };
  const issuer = [...issuers.values()].reduce<{ name: string; value: Decimal } | null>(
    (m, x) => (!m || x.value.gt(m.value) ? x : m),
    null,
  );
  return {
    issuer: check(issuer, limits.issuerPct),
    singleStock: check(stock, limits.singleStockPct),
    crypto: check({ name: null, value: crypto }, limits.cryptoPct),
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
