import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { AnalyticsHeader } from '@/components/analytics/header';
import { DrawdownChart } from '@/components/charts/drawdown-chart';
import { EmptyState } from '@/components/ui/empty-state';
import { LimitPill } from '@/components/ui/pill';
import { db } from '@/db/client';
import { instruments } from '@/db/schema';
import type { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import { formatMoney, formatMonthRange, formatMonthYear, formatPercent, formatPlain } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { listPortfolios } from '@/server/portfolio-data';
import { riskData } from '@/server/risk-data';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.risk };

const Params = z.object({ portfolio: z.string().max(64).optional().catch(undefined) });
const SWATCHES = ['bg-class-stocks', 'bg-class-funds', 'bg-class-cash', 'bg-class-bonds', 'bg-class-crypto'];
const card =
  'flex flex-col gap-1.5 rounded-card border border-border bg-surface px-4 py-4 wide:px-6 wide:py-5';
const metric = 'num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric';

/** «Риск» (Risk, MRisk; FR-ANL-1…5). */
export default async function RiskPage({ searchParams }: PageProps<'/analytics/risk'>) {
  const session = await requireSession();
  const userId = session.user.id;
  const params = Params.parse(await searchParams);
  const settings = getSettings(db(), userId);
  const portfolios = listPortfolios(db(), userId);
  const selected = portfolios.find((p) => p.id === params.portfolio) ?? null;
  const header = (
    <AnalyticsHeader
      portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
      portfolioId={selected?.id ?? null}
    />
  );
  const r = riskData(db(), userId, selected, settings);
  if (r.value.isZero() && r.index.length === 0)
    return (
      <>
        {header}
        <EmptyState title={ru.analytics.empty} />
      </>
    );

  const benchTicker = r.benchmarkId
    ? (db().select({ t: instruments.ticker }).from(instruments).where(eq(instruments.id, r.benchmarkId)).get()
        ?.t ?? null)
    : null;
  const pct = (v: Decimal, digits = 1) => formatPercent(v.toFixed(digits), { digits });
  const share = (v: Decimal) => formatPercent(v.toFixed(1));
  const dd = r.drawdown;
  const ddNote = dd
    ? dd.recoveryDays !== null
      ? ru.risk.recovered(formatMonthRange(dd.peakDate, dd.troughDate), ru.risk.days(dd.recoveryDays))
      : ru.risk.notRecovered(formatMonthRange(dd.peakDate, dd.troughDate))
    : ru.risk.noDrawdown;
  const betaWord = (short: boolean) => {
    if (!r.beta) return r.benchmarkId ? ru.risk.notEnough : ru.risk.noBenchmark;
    if (r.beta.lt(0.9)) return short ? ru.risk.betaWeakerShort : ru.risk.betaWeaker;
    if (r.beta.gt(1.1)) return short ? ru.risk.betaStrongerShort : ru.risk.betaStronger;
    return short ? ru.risk.betaSameShort : ru.risk.betaSame;
  };
  const benchVol = r.benchmarkVolatility ? pct(r.benchmarkVolatility.times(100)) : null;
  const benchGenitive = benchTicker ? (ru.benchmarks.genitive[benchTicker] ?? benchTicker) : '';
  const top = r.largest.top;
  const lim = r.limits;
  const limitsHref = '/settings#limits';

  return (
    <>
      {header}
      <div
        className="grid grid-cols-2 gap-3 wide:grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] wide:gap-4"
        data-testid="risk-cards"
      >
        <section className={card}>
          <div className="text-caption text-muted">
            <span className="wide:hidden">{ru.risk.maxDrawdownShort}</span>
            <span className="max-wide:hidden">{ru.risk.maxDrawdown}</span>
          </div>
          <div className={cn(metric, dd && 'text-loss')}>
            {dd ? formatPercent(dd.depth.times(100).toFixed(1)) : formatPercent('0')}
          </div>
          <div className="text-small text-muted">{ddNote}</div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">
            <span className="wide:hidden">{ru.risk.volatilityShort}</span>
            <span className="max-wide:hidden">{ru.risk.volatility}</span>
          </div>
          <div className={metric}>{r.volatility ? pct(r.volatility.times(100)) : ru.common.none}</div>
          {benchVol ? (
            <div className="text-small text-muted">
              <span className="wide:hidden">{ru.risk.benchVolatilityShort(benchVol)}</span>
              <span className="max-wide:hidden">{ru.risk.benchVolatility(benchGenitive, benchVol)}</span>
            </div>
          ) : null}
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{ru.risk.beta}</div>
          <div className={metric}>{r.beta ? formatPlain(r.beta, 2) : ru.common.none}</div>
          <div className="text-small text-muted">
            <span className="wide:hidden">{betaWord(true)}</span>
            <span className="max-wide:hidden">{betaWord(false)}</span>
          </div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{ru.risk.worstMonth}</div>
          <div className={cn(metric, r.worstMonth?.ret.lt(0) && 'text-loss')}>
            {r.worstMonth
              ? formatPercent(r.worstMonth.ret.times(100).toFixed(1), { signed: true })
              : ru.common.none}
          </div>
          <div className="text-small text-muted">
            {r.worstMonth ? formatMonthYear(r.worstMonth.month) : ru.risk.notEnough}
          </div>
        </section>
      </div>

      <DrawdownChart points={r.index.map((p) => ({ date: p.date, index: p.index.toString() }))} />

      <div className="flex flex-wrap items-start gap-3 wide:gap-4">
        <section
          className="flex min-w-0 flex-[3_1_440px] flex-col gap-[18px] rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="risk-largest"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.risk.largestTitle}</h2>
            <span className="text-small text-muted">
              <span className="wide:hidden">{ru.risk.largestHintShort}</span>
              <span className="max-wide:hidden">{ru.risk.largestHint}</span>
            </span>
          </div>
          {top.length === 0 ? (
            <div className="text-caption text-muted">{ru.risk.noPositions}</div>
          ) : (
            <div className="flex flex-col gap-3.5 text-row">
              {top.map((h) => (
                <div key={h.instrumentId} className="flex flex-col gap-[7px]">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <Link
                        href={`/assets/${h.instrumentId}${selected ? `?portfolio=${selected.id}` : ''}`}
                        className="num text-caption text-text no-underline hover:text-text"
                      >
                        {h.ticker && h.kind !== 'bond' ? h.ticker : h.name}
                      </Link>
                      {h.ticker && h.kind !== 'bond' && h.ticker !== h.name ? (
                        <span className="text-muted"> {h.name}</span>
                      ) : null}
                    </span>
                    <span className="num text-caption whitespace-nowrap">
                      <span className="max-wide:hidden">
                        {formatMoney(Money.of(h.value.round(), 'RUB'))} ·{' '}
                      </span>
                      {share(h.share)}
                    </span>
                  </div>
                  <div className="h-2 rounded-[4px] bg-track">
                    <div
                      className="h-full rounded-[4px] bg-accent"
                      style={{
                        width: `${Math.min(
                          100,
                          h.share
                            .div(lim.issuer.limit.isZero() ? 100 : lim.issuer.limit)
                            .times(100)
                            .toNumber(),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {top.length > 0 ? (
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5 text-caption">
              <span className="text-muted">{ru.risk.largestTotal(top.length)}</span>
              <span className="num">{share(r.largest.share)}</span>
            </div>
          ) : null}
        </section>

        <div className="flex min-w-0 flex-[2_1_340px] flex-col gap-3 wide:gap-4">
          <section
            className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6"
            data-testid="risk-currencies"
          >
            <h2 className="m-0 text-card font-semibold">{ru.risk.currenciesTitle}</h2>
            <div className="flex h-3.5 gap-[3px]" aria-hidden="true">
              {r.currencies.map((c, i) => (
                <div
                  key={c.key}
                  className={cn('rounded-[3px]', SWATCHES[i % SWATCHES.length])}
                  style={{ flex: `${c.share.toNumber()} 1 0` }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-2.5 text-row">
              {r.currencies.map((c, i) => (
                <div key={c.key} className="flex items-center gap-2.5">
                  <span
                    className={cn('size-2.5 rounded-[3px]', SWATCHES[i % SWATCHES.length])}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{ru.risk.currencyNames[c.key] ?? c.key}</span>
                  <span className="num">{share(c.share)}</span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
            data-testid="risk-limits"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 text-card font-semibold">{ru.risk.limitsTitle}</h2>
              <Link href={limitsHref} className="text-caption no-underline">
                {ru.risk.limitsEdit}
              </Link>
            </div>
            <div className="flex flex-col">
              {[
                {
                  title: ru.risk.issuer(formatPercent(lim.issuer.limit, { digits: 0 })),
                  note: lim.issuer.name
                    ? ru.risk.issuerNow(share(lim.issuer.share), lim.issuer.name)
                    : ru.risk.now(share(lim.issuer.share)),
                  over: lim.issuer.exceeded,
                },
                {
                  title: ru.risk.crypto(formatPercent(lim.crypto.limit, { digits: 0 })),
                  note: ru.risk.now(share(lim.crypto.share)),
                  over: lim.crypto.exceeded,
                },
                {
                  title: ru.risk.stock(formatPercent(lim.singleStock.limit, { digits: 0 })),
                  note: lim.singleStock.name
                    ? ru.risk.stockNow(lim.singleStock.name, share(lim.singleStock.share))
                    : ru.risk.noStocks,
                  over: lim.singleStock.exceeded,
                },
              ].map((l) => (
                <div
                  key={l.title}
                  className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{l.title}</span>
                    <span className="text-small text-muted">{l.note}</span>
                  </span>
                  <LimitPill ok={!l.over} label={l.over ? ru.risk.over : ru.risk.ok} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
