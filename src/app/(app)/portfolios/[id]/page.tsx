import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ValueChart } from '@/components/charts/value-chart';
import { PositionsTable, type PositionItem } from '@/components/portfolio/positions-table';
import { Button } from '@/components/ui/button';
import { TargetBar } from '@/components/ui/target-bar';
import { db } from '@/db/client';
import { listAccounts } from '@/db/queries/accounts';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import {
  approx,
  formatChange,
  formatCrypto,
  formatMoney,
  formatPercent,
  formatPlain,
  formatQuantity,
  formatSigned,
  formatShareOfTarget,
  formatTradeAmount,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import {
  areaSeries,
  flowsFor,
  listPortfolios,
  loadFx,
  loadUserLedger,
  loadValuedCells,
  portfolioScope,
  profitSplit,
  summarizeArea,
  tagNames,
} from '@/server/portfolio-data';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.portfolio };

const rub = (v: Decimal) => formatMoney(Money.of(v, 'RUB'));
const change = (v: Decimal) => formatChange(Money.of(v, 'RUB'));
const plainRub = (v: Decimal) => formatPlain(v, 0);

export default async function PortfolioPage({ params }: PageProps<'/portfolios/[id]'>) {
  const session = await requireSession();
  const userId = session.user.id;
  const { id } = await params;
  const portfolio = listPortfolios(db(), userId).find((p) => p.id === id);
  if (!portfolio) notFound();

  const tz = getSettings(db(), userId).display.timezone;
  const fx = loadFx(db());
  const cells = loadValuedCells(db(), userId, fx);
  const ledger = loadUserLedger(db(), userId);
  const scope = portfolioScope(portfolio);
  const s = summarizeArea(db(), userId, scope, cells, ledger, fx, tz, {
    values: portfolio.targetsEnabled ? portfolio.targets : new Map(),
    threshold: portfolio.deviationThreshold,
  });
  const split = profitSplit(db(), userId, scope, cells, fx);
  const series = areaSeries(db(), userId, scope, flowsFor(ledger, scope, fx, tz), s.value, tz);
  const accounts = new Map(listAccounts(db(), userId).map((a) => [a.id, a]));
  const tags = tagNames(db(), userId);

  const ordered = [...s.cells].sort((a, b) => b.valueRub.comparedTo(a.valueRub));
  const items: PositionItem[] = ordered.map((c) => {
    const share = s.value.isZero() ? new Decimal(0) : c.valueRub.div(s.value).times(100);
    const result = c.costRub ? c.valueRub.minus(c.costRub) : null;
    const resultPct = result && c.costRub && !c.costRub.isZero() ? result.div(c.costRub).times(100) : null;
    const account = accounts.get(c.accountId);
    return {
      key: `${c.accountId}|${c.instrumentId}|${c.tagId ?? ''}`,
      instrumentId: c.instrumentId,
      // Bonds read better by name («ОФЗ 26238») than by their exchange code.
      ticker: c.kind === 'bond' || !c.ticker ? c.name : c.ticker,
      name: c.kind === 'bond' || !c.ticker ? null : c.name,
      account: account ? ru.portfolio.accountChip(account.name, account.sourceKind === 'manual') : '',
      assetClass: c.assetClass,
      quantity:
        c.kind === 'crypto'
          ? formatCrypto(c.quantity)
          : formatQuantity(c.quantity.toDecimalPlaces(c.isCash ? 0 : 8)),
      avg: c.avgPriceRub ? formatTradeAmount(c.avgPriceRub) : ru.common.none,
      price: c.isCash
        ? ru.common.none
        : c.priceRub
          ? formatTradeAmount(c.priceRub)
          : approx(formatTradeAmount(c.avgPriceRub ?? 0)),
      value: c.approx ? approx(plainRub(c.valueRub)) : plainRub(c.valueRub),
      share: formatPercent(share),
      result: result
        ? `${formatSigned(result)} · ${formatPercent(resultPct ?? 0, { signed: true })}`
        : ru.common.none,
      tone: result ? (result.gt(0) ? 'gain' : result.lt(0) ? 'loss' : 'default') : 'default',
      approx: c.approx,
      canSetPrice: !c.isCash && (c.kind === 'custom' || c.approx),
      currency: c.currency,
    };
  });

  const rulesChips = portfolio.rules.map((r) => {
    const a = accounts.get(r.accountId);
    return { key: r.accountId, text: a ? ru.portfolio.accountChip(a.name, a.sourceKind === 'manual') : '' };
  });
  const tagChips = [
    ...new Set(portfolio.rules.filter((r) => r.mode === 'tag').map((r) => tags.get(r.tagId ?? '') ?? '')),
  ];

  return (
    <>
      <header className="flex flex-col gap-3 wide:mb-2">
        <div className="hidden items-center gap-2 text-caption text-muted wide:flex">
          <Link href="/" className="no-underline">
            {ru.pages.overview}
          </Link>
          <span>/</span>
          <Link href="/portfolios" className="no-underline">
            {ru.pages.portfolios}
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 wide:gap-4">
          <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">
            {portfolio.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 wide:gap-3">
            <Button asChild variant="secondary">
              <Link href={`/portfolios/${id}/edit`}>{ru.portfolio.edit}</Link>
            </Button>
            <Button asChild variant="primary" className="hidden wide:inline-flex">
              <Link href="/operations/new">{ru.portfolio.addOperation}</Link>
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-caption">
          <span className="text-muted">{ru.portfolio.madeOf}</span>
          {[...rulesChips.map((c) => c.text), ...tagChips.map((t) => ru.portfolio.tagChip(t))].map((text) => (
            <span key={text} className="rounded-pill border border-border bg-surface px-2.5 py-1">
              {text}
            </span>
          ))}
        </div>
      </header>

      <div
        className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3 wide:gap-4"
        data-testid="portfolio-stats"
      >
        <section className="flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5">
          <div className="text-caption text-muted">{ru.portfolio.value}</div>
          <div className="num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric">
            {s.approx ? approx(rub(s.value)) : rub(s.value)}
          </div>
          {s.dayChange ? (
            <div
              className={cn(
                'num text-small whitespace-nowrap',
                s.dayChange.gte(0) ? 'text-gain' : 'text-loss',
              )}
            >
              {ru.portfolio.today(change(s.dayChange))}
            </div>
          ) : null}
        </section>
        <section className="flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5">
          <div className="text-caption text-muted">{ru.portfolio.profit}</div>
          <div
            className={cn(
              'num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric',
              s.profit.gte(0) ? 'text-gain' : 'text-loss',
            )}
          >
            {change(s.profit)}
          </div>
          <div className="text-small text-muted">
            {ru.portfolio.profitSplit(formatSigned(split.course), formatSigned(split.payouts))}
          </div>
        </section>
        <section className="flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5">
          <div className="text-caption text-muted">{ru.portfolio.invested}</div>
          <div className="num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric">
            {rub(s.invested)}
          </div>
          {s.profitPct ? (
            <div className="num text-small text-muted">{formatPercent(s.profitPct, { signed: true })}</div>
          ) : null}
        </section>
      </div>

      <div className="flex flex-wrap gap-3 wide:gap-4">
        <section className="flex min-w-0 flex-[3_1_480px] flex-col gap-3.5 rounded-card border border-border bg-surface p-4 wide:p-6">
          <h2 className="m-0 text-card font-semibold">{ru.portfolio.chartTitle}</h2>
          <ValueChart
            points={series.map((p) => ({
              date: p.date,
              value: p.value.toNumber(),
              invested: p.invested.toNumber(),
            }))}
            currency="RUB"
            label={ru.portfolio.chartLabel(portfolio.name)}
          />
        </section>
        <section
          className="flex min-w-0 flex-[2_1_300px] flex-col gap-[18px] rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="targets"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.portfolio.targetsTitle}</h2>
            {portfolio.targetsEnabled ? (
              <span className="text-small text-muted">{ru.portfolio.targetsHint}</span>
            ) : null}
          </div>
          {portfolio.targetsEnabled ? (
            <>
              <div className="flex flex-col gap-3.5">
                {s.classes.map((c) => (
                  <TargetBar
                    key={c.assetClass}
                    label={ru.classesShort[c.assetClass] ?? c.assetClass}
                    valueLabel={formatShareOfTarget(c.share, c.target)}
                    actual={c.share.toNumber()}
                    target={c.target?.toNumber() ?? 0}
                    scaleMax={50}
                    offTarget={c.offTarget}
                  />
                ))}
              </div>
              <Button asChild variant="secondary-raised" className="self-start">
                <Link href={`/portfolios/${id}/rebalance`}>{ru.portfolio.rebalance}</Link>
              </Button>
            </>
          ) : (
            <div className="text-caption text-muted">{ru.portfolio.noTargets}</div>
          )}
        </section>
      </div>

      <PositionsTable items={items} count={items.length} />
    </>
  );
}
