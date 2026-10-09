import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AssetChart } from '@/components/charts/asset-chart';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Table, Td, Th } from '@/components/ui/table';
import { db } from '@/db/client';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import {
  formatChange,
  formatDateYear,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatTradeAmount,
  formatTradeMoney,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { assetView } from '@/server/asset-data';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.asset };

const card = 'flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5';
const metric = 'num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric';
const rub = (v: Parameters<typeof Money.of>[0]) => formatMoney(Money.of(v, 'RUB'));
const signedRub = (v: Parameters<typeof Money.of>[0]) => formatChange(Money.of(v, 'RUB'));

/** «Актив» (Asset, MAsset; FR-AST-1…3). `?portfolio=` narrows the figures to the portfolio one came from. */
export default async function AssetPage({ params, searchParams }: PageProps<'/assets/[id]'>) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const portfolioId = typeof sp.portfolio === 'string' ? sp.portfolio : undefined;
  const v = assetView(db(), session.user.id, id, portfolioId);
  if (!v) notFound();
  const tz = getSettings(db(), session.user.id).display.timezone;
  const i = v.instrument;
  const title = i.name;
  const code = i.kind === 'bond' ? null : i.ticker;
  const holding = v.holdings
    .map((h) =>
      [
        h.accountName +
          (h.sourceKind === 'manual'
            ? `, ${ru.journal.origins.manual!.toLowerCase()}`
            : h.sourceKind === 'tinvest'
              ? ', авто'
              : ''),
        h.tagName ? ru.portfolio.tagChip(h.tagName) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    )
    .join('; ');
  const sameCurrency = v.priceCurrency === i.currency;

  return (
    <>
      <header className="flex flex-col gap-3 wide:mb-2">
        <div className="hidden items-center gap-2 text-caption text-muted wide:flex">
          <Link href="/portfolios" className="no-underline">
            {ru.pages.portfolios}
          </Link>
          {v.portfolio ? (
            <>
              <span>/</span>
              <Link href={`/portfolios/${v.portfolio.id}`} className="no-underline">
                {v.portfolio.name}
              </Link>
            </>
          ) : null}
          <span>/</span>
          <span>{code ?? title}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 wide:gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={v.portfolio ? `/portfolios/${v.portfolio.id}` : '/portfolios'}
                aria-label={ru.asset.back}
                className="-mr-2 -ml-3 flex size-11 items-center justify-center text-text wide:hidden"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </Link>
              <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">{title}</h1>
              {code ? <Pill className="num px-2.5 py-1">{code}</Pill> : null}
            </div>
            <span className="text-caption text-muted">
              {[ru.classes[i.assetClass] ?? i.assetClass, holding].filter(Boolean).join(' · ')}
            </span>
          </div>
          <Button asChild variant="primary" className="max-wide:hidden">
            <Link href="/operations/new">{ru.asset.addOperation}</Link>
          </Button>
        </div>
      </header>

      <div
        className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3 wide:gap-4"
        data-testid="asset-stats"
      >
        <section className={card}>
          <div className="text-caption text-muted">{ru.asset.position}</div>
          <div className={metric}>{ru.asset.pieces(formatQuantity(v.quantity))}</div>
          <div className="num text-small text-muted">
            {ru.asset.positionValue(
              rub(v.valueRub),
              v.shareOfArea ? formatPercent(v.shareOfArea) : null,
              v.portfolio !== null,
            )}
          </div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{ru.asset.avgPrice}</div>
          <div className={metric}>
            {v.avgPrice ? formatTradeMoney(Money.of(v.avgPrice, v.priceCurrency)) : ru.common.none}
          </div>
          {v.price ? (
            <div className="num text-small text-muted">
              {ru.asset.now(formatTradeMoney(Money.of(v.price, v.priceCurrency)))}
            </div>
          ) : null}
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{ru.asset.course}</div>
          <div className={cn(metric, v.courseRub.gte(0) ? 'text-gain' : 'text-loss')}>
            {signedRub(v.courseRub)}
          </div>
          {v.coursePct ? (
            <div className="num text-small text-muted">
              {ru.asset.toAvg(formatPercent(v.coursePct, { signed: true }))}
            </div>
          ) : null}
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{ru.asset.total}</div>
          <div className={cn(metric, v.totalRub.gte(0) ? 'text-gain' : 'text-loss')}>
            {signedRub(v.totalRub)}
          </div>
          <div className="num text-small text-muted">
            {ru.asset.totalNote(
              rub(v.payoutsRub),
              v.totalPct ? formatPercent(v.totalPct, { signed: true }) : null,
            )}
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-3.5 rounded-card border border-border bg-surface p-4 wide:p-6">
        <h2 className="m-0 text-card font-semibold">{ru.asset.chartTitle}</h2>
        <AssetChart
          points={v.chart}
          avg={sameCurrency && v.avgPrice ? v.avgPrice.toNumber() : null}
          markers={v.markers}
          firstBuy={v.firstBuy}
          label={ru.asset.chartLabel(title)}
        />
      </section>

      <div className="flex flex-wrap items-start gap-3 wide:gap-4">
        <section
          className="flex min-w-0 flex-[3_1_480px] flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="asset-operations"
        >
          <h2 className="m-0 text-card font-semibold">{ru.asset.operations}</h2>
          {v.operations.length === 0 ? (
            <div className="text-caption text-muted">{ru.asset.operationsEmpty}</div>
          ) : (
            <>
              <div className="hidden wide:block">
                <Table minWidth={520}>
                  <thead>
                    <tr>
                      <Th>{ru.asset.columns.date}</Th>
                      <Th>{ru.asset.columns.operation}</Th>
                      <Th align="right">{ru.asset.columns.quantity}</Th>
                      <Th align="right">{ru.asset.columns.amount}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.operations.map((o) => (
                      <tr key={o.id} className="[&:last-child>td]:border-b-0">
                        <Td mono className="text-caption text-muted">
                          {formatDateYear(o.at, tz)}
                        </Td>
                        <Td>
                          <Link
                            href={`/operations/${o.id}/edit`}
                            className="text-text no-underline hover:text-text"
                          >
                            {ru.journal.types[o.type]}
                          </Link>
                        </Td>
                        <Td align="right" mono className="text-caption">
                          {o.quantity.isZero()
                            ? ru.common.none
                            : `${formatQuantity(o.quantity)} × ${formatTradeAmount(o.price)}`}
                        </Td>
                        <Td
                          align="right"
                          mono
                          className={cn(
                            'text-caption',
                            ['dividend', 'coupon', 'interest'].includes(o.type) && 'text-gain',
                          )}
                        >
                          {formatChange(Money.of(o.amount, o.currency))}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
                {v.operations.map((o) => (
                  <li
                    key={o.id}
                    className="flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span>
                        {ru.journal.types[o.type]}, {formatDateYear(o.at, tz)}
                      </span>
                      {!o.quantity.isZero() ? (
                        <span className="num text-small text-muted">
                          {formatQuantity(o.quantity)} × {formatTradeAmount(o.price)}
                        </span>
                      ) : null}
                    </span>
                    <span className="num text-row whitespace-nowrap">
                      {formatChange(Money.of(o.amount, o.currency))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section
          className="flex min-w-0 flex-[2_1_320px] flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="asset-where"
        >
          <h2 className="m-0 text-card font-semibold">{ru.asset.where}</h2>
          <div className="flex flex-col">
            {v.portfolios.length === 0 ? (
              <div className="pb-3 text-caption text-muted">{ru.asset.nowhere}</div>
            ) : null}
            {v.portfolios.map((p) => (
              <Link
                key={p.id}
                href={`/portfolios/${p.id}`}
                className="flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle text-text no-underline hover:text-text"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-small text-muted">{ru.asset.pieces(formatQuantity(p.quantity))}</span>
                </span>
                <span className="num text-row">{formatPercent(p.share)}</span>
              </Link>
            ))}
            {v.overallShare ? (
              <div
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3',
                  v.limit && 'border-b border-border-subtle',
                )}
              >
                <span className="text-muted">{ru.asset.allPortfolios}</span>
                <span className="num text-row">{formatPercent(v.overallShare)}</span>
              </div>
            ) : null}
            {v.limit ? (
              <div className="flex min-h-14 items-center justify-between gap-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-muted">{ru.asset.limit}</span>
                  <span className="text-small text-muted">
                    {ru.asset.limitValue(formatPercent(v.limit.pct, { digits: 0 }))}
                  </span>
                </span>
                <Pill tone={v.limit.ok ? 'gain' : 'loss'} className="px-2.5 py-1">
                  <span
                    className={cn('size-[7px] rounded-full', v.limit.ok ? 'bg-gain' : 'bg-loss')}
                    aria-hidden="true"
                  />
                  {v.limit.ok ? ru.asset.limitOk : ru.asset.limitOver}
                </Pill>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
