import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReturnsChart } from '@/components/charts/returns-chart';
import { ValueChart } from '@/components/charts/value-chart';
import { WhatIfControls } from '@/components/portfolio/whatif-controls';
import { eq } from 'drizzle-orm';
import { instruments } from '@/db/schema';
import { PositionsTable, type PositionItem } from '@/components/portfolio/positions-table';
import { SnapshotBanner, SnapshotPicker } from '@/components/portfolio/snapshot-date';
import { PortfolioMap, type MapTileView } from '@/components/portfolio/portfolio-map';
import { TargetsCard, type TargetRow } from '@/components/portfolio/targets-card';
import { MAP_PERIODS, mapTiles } from '@/server/map-data';
import { sectorAllocation } from '@/domain/sectors';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { listAccounts } from '@/db/queries/accounts';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import {
  approx,
  formatChange,
  formatDateLong,
  formatDateYear,
  formatCrypto,
  formatMoney,
  formatPercent,
  formatPlain,
  formatPp,
  formatQuantity,
  formatSigned,
  formatShareOfTarget,
  formatTradeAmount,
} from '@/lib/format';
import { assetLabel } from '@/lib/asset-label';
import { localDate } from '@/lib/time';
import { ru } from '@/lib/i18n/ru';
import {
  areaMetrics,
  endOfLocalDay,
  firstSnapshotDate,
  ledgerUntil,
  loadValuedCellsAt,
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
import { WHATIF_CHOICES, whatIfData, type WhatIfChoice } from '@/server/whatif-data';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.portfolio };

const rub = (v: Decimal) => formatMoney(Money.of(v, 'RUB'));
const change = (v: Decimal) => formatChange(Money.of(v, 'RUB'));
const plainRub = (v: Decimal) => formatPlain(v, 0);

export default async function PortfolioPage({ params, searchParams }: PageProps<'/portfolios/[id]'>) {
  const session = await requireSession();
  const userId = session.user.id;
  const { id } = await params;
  const portfolio = listPortfolios(db(), userId).find((p) => p.id === id);
  if (!portfolio) notFound();

  const tz = getSettings(db(), userId).display.timezone;
  const fx = loadFx(db());
  const ledger = loadUserLedger(db(), userId);
  const scope = portfolioScope(portfolio);
  const targets = {
    values: portfolio.targetsEnabled ? portfolio.targets : new Map(),
    threshold: portfolio.deviationThreshold,
  };
  // «Срез на дату» (FR-PRT-7): a past day from its snapshot, the journal up to its end.
  const today = localDate(new Date(), tz);
  const asked = (await searchParams).date;
  const date = typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked < today ? asked : null;
  const end = date ? endOfLocalDay(date, tz) : new Date();
  const ledgerAt = date ? ledgerUntil(ledger, end) : ledger;
  const cells = date
    ? loadValuedCellsAt(db(), userId, date, ledgerAt, fx)
    : loadValuedCells(db(), userId, fx);
  const s = summarizeArea(db(), userId, scope, cells, ledgerAt, fx, tz, targets, end);
  const firstDay = firstSnapshotDate(db(), userId);
  // «А если бы» (FR-PRT-8): the portfolio's own index by default; a rate of 0–100 % for «свой процент».
  const sp = await searchParams;
  const choice: WhatIfChoice = WHATIF_CHOICES.includes(sp.whatif as WhatIfChoice)
    ? (sp.whatif as WhatIfChoice)
    : 'MCFTR';
  const rateText =
    typeof sp.rate === 'string' && /^\d{1,2}(\.\d{1,4})?$|^100$/.test(sp.rate) ? sp.rate : '12';
  const whatIf = date
    ? null
    : whatIfData(db(), userId, scope, ledger, fx, s.value, tz, choice, new Decimal(rateText));
  const dateText = date ? formatDateLong(new Date(`${date}T12:00:00Z`), 'UTC') : '';
  const split = profitSplit(db(), userId, scope, cells, fx);
  const settings = getSettings(db(), userId);
  const metrics = areaMetrics(db(), userId, scope, cells, ledger, fx, settings, portfolio.benchmarkId);
  const returns = metrics.returns;
  const benchTicker = metrics.benchmarkId
    ? (db()
        .select({ t: instruments.ticker })
        .from(instruments)
        .where(eq(instruments.id, metrics.benchmarkId))
        .get()?.t ?? null)
    : null;
  const benchName = benchTicker ? (ru.benchmarks.names[benchTicker] ?? benchTicker) : null;
  const benchDative = benchTicker ? (ru.benchmarks.dative[benchTicker] ?? benchTicker) : '';
  const primary =
    metrics.primary === 'twr'
      ? { label: ru.portfolio.twr, value: metrics.twr, note: ru.portfolio.twrNote }
      : {
          label: ru.portfolio.xirr,
          value: metrics.xirr?.rate ?? null,
          note: metrics.xirr?.shortPeriod ? ru.portfolio.xirrShort : ru.portfolio.xirrNote,
        };
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
      href: c.isCash ? null : `/assets/${c.instrumentId}?portfolio=${id}`,
      ticker: assetLabel(c).code ?? c.name,
      name: assetLabel(c).code ? c.name : null,
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
      canSetPrice: !date && !c.isCash && (c.kind === 'custom' || c.approx),
      currency: c.currency,
    };
  });

  // «Цели и ребаланс»: what reaches each target, for the row's tooltip (FR-PRT-4, FR-PRT-10).
  const hintOf = (name: string, share: Decimal, target: Decimal | null, move: Decimal | null) => {
    if (target === null || move === null || move.abs().lt(1)) return null;
    const pp = formatPlain(share.minus(target).abs(), 1);
    return {
      title: move.lt(0) ? ru.targetsCard.above(name, pp) : ru.targetsCard.below(name, pp),
      action: move.lt(0) ? ru.targetsCard.sell(rub(move.abs())) : ru.targetsCard.buy(rub(move)),
    };
  };
  const classRows: TargetRow[] = s.classes.map((c) => {
    const name = ru.classesShort[c.assetClass] ?? c.assetClass;
    const move = c.target ? c.target.div(100).times(s.value).minus(c.value) : null;
    return {
      key: c.assetClass,
      label: name,
      valueLabel: formatShareOfTarget(c.share, c.target),
      actual: c.share.toNumber(),
      target: c.target?.toNumber() ?? null,
      offTarget: c.offTarget,
      hint: hintOf(name, c.share, c.target, move),
    };
  });
  const sectorView = sectorAllocation(
    s.cells
      .filter((c) => c.assetClass === 'stocks' || c.assetClass === 'funds')
      .map((c) => ({ sector: c.sector ?? '', value: c.valueRub })),
    portfolio.sectorTargets,
    portfolio.deviationThreshold,
  );
  const sectorRows: TargetRow[] = sectorView.rows.map((r) => {
    const name = ru.sectors[r.sector] ?? r.sector;
    return {
      key: r.sector || 'none',
      label: name,
      valueLabel: r.target ? formatShareOfTarget(r.share, r.target) : formatPercent(r.share),
      actual: r.share.toNumber(),
      target: r.target?.toNumber() ?? null,
      offTarget: r.offTarget,
      muted: r.sector === '',
      hint: hintOf(name, r.share, r.target, r.move),
    };
  });

  // «Карта портфеля» (FR-PRT-11): today's positions only, the change is to now.
  const mapView: MapTileView[] = date
    ? []
    : mapTiles(db(), userId, s.cells, fx, tz).map((m) => {
        const label = assetLabel(m);
        return {
          key: m.instrumentId,
          href: m.isCash ? null : `/assets/${m.instrumentId}?portfolio=${id}`,
          title: m.isCash ? (m.ticker ?? m.name) : (label.code ?? m.name),
          subtitle: m.isCash || !label.code ? null : m.name,
          valueText: rub(m.value),
          share: m.share.toNumber(),
          changes: Object.fromEntries(MAP_PERIODS.map((p) => [p, m.changes[p]?.toNumber() ?? null])),
          changeTexts: Object.fromEntries(
            MAP_PERIODS.map((p) => {
              const c = m.changes[p];
              return [
                p,
                c
                  ? formatPercent(c.toFixed(1), { signed: !c.toDecimalPlaces(1).isZero() })
                  : ru.portfolioMap.noHistory,
              ];
            }),
          ),
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
            <SnapshotPicker
              date={date}
              today={today}
              min={firstDay}
              dateShort={date ? formatDateYear(new Date(`${date}T12:00:00Z`), 'UTC') : null}
            />
            <Button asChild variant="secondary">
              <Link href={`/portfolios/${id}/edit`}>{ru.portfolio.edit}</Link>
            </Button>
            <Button asChild variant="primary" className="max-wide:hidden">
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

      {date ? <SnapshotBanner dateText={dateText} /> : null}

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
              {date ? ru.snapshot.dayChange(change(s.dayChange)) : ru.portfolio.today(change(s.dayChange))}
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
            {date
              ? ru.snapshot.invested(rub(s.invested))
              : ru.portfolio.profitSplit(formatSigned(split.course), formatSigned(split.payouts))}
          </div>
        </section>
        {date ? null : (
          <section
            className="flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5"
            data-testid="portfolio-xirr"
          >
            <div className="text-caption text-muted">{primary.label}</div>
            <div
              className={cn(
                'num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric',
                primary.value && (primary.value.gte(0) ? 'text-gain' : 'text-loss'),
              )}
            >
              {primary.value ? formatPercent(primary.value.times(100), { signed: true }) : ru.common.none}
            </div>
            <div className="text-small text-muted">{primary.note}</div>
          </section>
        )}
        {benchName && !date ? (
          <section
            className="flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5"
            data-testid="portfolio-benchmark"
          >
            <div className="text-caption text-muted">
              {returns.year.fullYear
                ? ru.portfolio.versusYear(benchDative)
                : ru.portfolio.versusSince(benchDative)}
            </div>
            <div
              className={cn(
                'num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric',
                returns.year.pp && (returns.year.pp.gte(0) ? 'text-gain' : 'text-loss'),
              )}
            >
              {returns.year.pp ? formatPp(returns.year.pp) : ru.common.none}
            </div>
            {returns.year.portfolio && returns.year.benchmark ? (
              <div className="num text-small text-muted">
                {ru.portfolio.twrVersus(
                  formatPercent(returns.year.portfolio.times(100)),
                  formatPercent(returns.year.benchmark.times(100)),
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3 wide:gap-4">
        <section className="flex min-w-0 flex-[3_1_480px] flex-col gap-3.5 rounded-card border border-border bg-surface p-4 wide:p-6">
          <h2 className="m-0 text-card font-semibold">{ru.portfolio.returnsTitle}</h2>
          <ReturnsChart
            points={returns.points.map((p) => ({
              date: p.date,
              growth: p.growth.toNumber(),
              bench: p.bench?.toNumber() ?? null,
            }))}
            name={portfolio.name}
            benchName={benchName}
            label={ru.portfolio.returnsLabel(portfolio.name, benchName ?? '')}
            selectDate
          />
        </section>
        <TargetsCard
          classes={classRows}
          sectors={sectorRows}
          classesEnabled={portfolio.targetsEnabled}
          sectorTargets={portfolio.sectorTargets.size > 0}
          rebalanceHref={date ? null : `/portfolios/${id}/rebalance`}
          editHref={`/portfolios/${id}/edit`}
        />
      </div>

      {mapView.length > 0 ? <PortfolioMap tiles={mapView} /> : null}

      {whatIf ? (
        <section
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="whatif"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.whatIf.title}</h2>
            <WhatIfControls choice={choice} rate={rateText} />
          </div>
          <div className="text-caption text-pretty text-muted">
            {ru.whatIf.text(formatDateLong(new Date(`${whatIf.from}T12:00:00Z`), 'UTC'))}
          </div>
          {whatIf.missing ? (
            <div className="rounded-control bg-surface-2 px-4 py-3.5 text-caption text-muted">
              {ru.whatIf.missing}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-4">
                <div className="flex flex-col gap-1">
                  <div className="text-small text-muted">{ru.whatIf.wouldBe}</div>
                  <div className="num text-body whitespace-nowrap">{rub(whatIf.alt)}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-small text-muted">{ru.whatIf.actual}</div>
                  <div className="num text-body whitespace-nowrap">{rub(whatIf.actual)}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-small text-muted">{ru.whatIf.diff}</div>
                  <div
                    className={cn(
                      'num text-body whitespace-nowrap',
                      whatIf.diff.gte(0) ? 'text-gain' : 'text-loss',
                    )}
                  >
                    {change(whatIf.diff)}
                    {whatIf.alt.gt(0)
                      ? ` · ${formatPercent(whatIf.diff.div(whatIf.alt).times(100), { signed: true })}`
                      : ''}
                  </div>
                </div>
              </div>
              <ValueChart
                points={whatIf.points.map((p) => ({
                  date: p.date,
                  value: p.actual.toNumber(),
                  invested: p.alt.toNumber(),
                }))}
                currency="RUB"
                label={ru.whatIf.title}
                names={{ value: ru.whatIf.portfolio, invested: ru.whatIf.short[choice]! }}
              />
            </>
          )}
        </section>
      ) : null}

      {date && items.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-6 py-5 text-caption text-muted">
          {ru.snapshot.empty}
        </div>
      ) : (
        <PositionsTable items={items} count={items.length} />
      )}
    </>
  );
}
