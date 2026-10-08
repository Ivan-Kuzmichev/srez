import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { ValueChart } from '@/components/charts/value-chart';
import { IconOperations, IconSources, IconWallet } from '@/components/icons';
import { OverviewControls, PhonePortfolioFilter } from '@/components/overview/controls';
import { assetLabel } from '@/lib/asset-label';
import { PageHeader } from '@/components/shell/page-header';
import { ASSET_CLASS_COLOR, AllocationBar } from '@/components/ui/allocation-bar';
import { Button } from '@/components/ui/button';
import { ActionTile, EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Table, Td, Th } from '@/components/ui/table';
import { db } from '@/db/client';
import { listJournal } from '@/db/queries/operations';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { everything } from '@/domain/scope';
import { cn } from '@/lib/cn';
import {
  approx,
  formatChange,
  formatCrypto,
  formatDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatTradeAmount,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import {
  areaSeries,
  convertSeries,
  flowsFor,
  listPortfolios,
  loadFx,
  loadUserLedger,
  loadValuedCells,
  portfolioScope,
  rubPer,
  summarizeArea,
} from '@/server/portfolio-data';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.overview };

const Params = z.object({
  portfolio: z.string().max(64).optional().catch(undefined),
  cur: z.enum(['RUB', 'USD', 'EUR']).catch('RUB'),
});

export default async function OverviewPage({ searchParams }: PageProps<'/'>) {
  const session = await requireSession();
  const userId = session.user.id;
  const params = Params.parse(await searchParams);
  const tz = getSettings(db(), userId).display.timezone;

  const anyOperation = listJournal(db(), userId, { period: 'all' }, 1).total > 0;
  if (!anyOperation) {
    return (
      <>
        <PageHeader title={ru.pages.overview} />
        <EmptyState
          figure={formatMoney(Money.of(0, 'RUB'))}
          title={ru.overview.emptyTitle}
          description={ru.overview.emptyText}
          actions={
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
              <ActionTile
                primary
                href="/onboarding"
                icon={<IconSources size={22} />}
                title={ru.overview.tiles.tinvest}
                description={ru.overview.tiles.tinvestText}
              />
              <ActionTile
                href="/sources/wallets/new"
                icon={<IconWallet size={22} />}
                title={ru.overview.tiles.wallet}
                description={ru.overview.tiles.walletText}
              />
              <ActionTile
                href="/operations/new"
                icon={<IconOperations size={22} />}
                title={ru.overview.tiles.manual}
                description={ru.overview.tiles.manualText}
              />
            </div>
          }
        />
      </>
    );
  }

  const fx = loadFx(db());
  const cells = loadValuedCells(db(), userId, fx);
  const ledger = loadUserLedger(db(), userId);
  const portfolios = listPortfolios(db(), userId);
  const selected = portfolios.find((p) => p.id === params.portfolio) ?? null;
  const scope = selected ? portfolioScope(selected) : everything;
  const s = summarizeArea(db(), userId, scope, cells, ledger, fx, tz, null);
  const series = areaSeries(db(), userId, scope, flowsFor(ledger, scope, fx, tz), s.value, tz);

  // Display currency: today's values at today's rate, the history at the rate of each day (FR-OVR-5).
  const cur = params.cur;
  const nowRate = rubPer(fx, cur) ?? new Decimal(1);
  const conv = (v: Decimal) => v.div(nowRate);
  const money = (v: Decimal) => formatMoney(Money.of(conv(v), cur));
  const signed = (v: Decimal) => formatChange(Money.of(conv(v), cur));
  const chartPoints = convertSeries(series, fx, cur);

  const recent = listJournal(db(), userId, { period: 'all' }, 1).rows.slice(0, 5);

  return (
    <>
      <PageHeader
        title={ru.pages.overview}
        actions={
          <>
            <OverviewControls
              portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
              currency={cur}
              portfolioId={selected?.id ?? null}
            />
            <Button asChild variant="primary" className="max-wide:size-11 max-wide:px-0">
              <Link href="/operations/new" aria-label={ru.overview.add}>
                <span className="hidden wide:inline">{ru.overview.add}</span>
                <span aria-hidden="true" className="text-[20px] leading-none wide:hidden">
                  +
                </span>
              </Link>
            </Button>
          </>
        }
      />

      <PhonePortfolioFilter
        portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
        portfolioId={selected?.id ?? null}
      />

      <section
        className="flex flex-wrap gap-8 rounded-card border border-border bg-surface p-4 wide:p-7"
        aria-label={ru.overview.totalAll}
        data-testid="overview-total"
      >
        <div className="flex flex-[1_1_280px] flex-col justify-between gap-6">
          <div className="flex flex-col gap-2">
            <div className="text-caption text-muted">
              {selected ? ru.overview.totalOne(selected.name) : ru.overview.totalAll}
            </div>
            <div
              className="num text-hero-phone font-medium tracking-[-0.02em] whitespace-nowrap wide:text-hero"
              data-testid="overview-value"
            >
              {s.approx ? approx(money(s.value)) : money(s.value)}
            </div>
            {s.dayChange ? (
              <div
                className={cn(
                  'num text-row whitespace-nowrap',
                  s.dayChange.gte(0) ? 'text-gain' : 'text-loss',
                )}
              >
                {s.dayChangePct
                  ? ru.overview.today(
                      signed(s.dayChange),
                      formatPercent(s.dayChangePct, { signed: true, digits: 2 }),
                    )
                  : ru.overview.todayNoPct(signed(s.dayChange))}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-4 border-t border-border pt-5">
            <div className="flex flex-col gap-1">
              <div className="text-small text-muted">{ru.overview.invested}</div>
              <div className="num text-body whitespace-nowrap">{money(s.invested)}</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-small text-muted">{ru.overview.profit}</div>
              <div
                className={cn('num text-body whitespace-nowrap', s.profit.gte(0) ? 'text-gain' : 'text-loss')}
              >
                {signed(s.profit)}
              </div>
            </div>
            {s.profitPct ? (
              <div className="flex flex-col gap-1">
                <div className="text-small text-muted">{ru.overview.profitPct}</div>
                <div
                  className={cn(
                    'num text-body whitespace-nowrap',
                    s.profitPct.gte(0) ? 'text-gain' : 'text-loss',
                  )}
                >
                  {formatPercent(s.profitPct, { signed: true })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="min-w-0 flex-[3_1_480px]">
          <ValueChart points={chartPoints} currency={cur} label={ru.overview.chartLabel} />
        </div>
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-3 wide:gap-4">
        <section className="flex flex-col gap-5 rounded-card border border-border bg-surface p-4 wide:p-6">
          <h2 className="m-0 text-card font-semibold">{ru.overview.structure}</h2>
          <AllocationBar
            aria-label={ru.overview.structureLabel}
            segments={s.classes.map((c) => ({
              key: c.assetClass,
              label: ru.classes[c.assetClass] ?? c.assetClass,
              share: c.share.toNumber(),
              colorClass: ASSET_CLASS_COLOR[c.assetClass],
              amount: money(c.value),
              shareLabel: formatPercent(c.share),
            }))}
          />
        </section>

        <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.overview.portfolios}</h2>
            <Link href="/portfolios/new" className="text-caption no-underline">
              {ru.overview.newPortfolio}
            </Link>
          </div>
          {portfolios.length === 0 ? (
            <div className="text-caption text-muted">{ru.overview.noPortfolios}</div>
          ) : (
            <div className="flex flex-col">
              {portfolios.map((p) => {
                const ps = summarizeArea(db(), userId, portfolioScope(p), cells, ledger, fx, tz, null);
                return (
                  <Link
                    key={p.id}
                    href={`/portfolios/${p.id}`}
                    className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border-subtle py-1.5 text-text no-underline last:border-b-0 hover:text-text"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-small text-muted">
                        {ru.portfolios.positions(ps.cells.filter((c) => !c.isCash).length)}
                      </span>
                    </span>
                    <span className="num flex flex-col items-end gap-0.5 whitespace-nowrap">
                      <span className="text-row">{money(ps.value)}</span>
                      {ps.profitPct ? (
                        <span className={cn('text-small', ps.profitPct.gte(0) ? 'text-gain' : 'text-loss')}>
                          {formatPercent(ps.profitPct, { signed: true })}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          id="payouts"
        >
          <h2 className="m-0 text-card font-semibold">{ru.overview.payouts}</h2>
          <div className="text-caption text-muted">{ru.overview.payoutsLater}</div>
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-card font-semibold">{ru.overview.recent}</h2>
          <Link href="/operations" className="text-caption no-underline">
            {ru.overview.allJournal}
          </Link>
        </div>
        <div className="hidden wide:block">
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>{ru.journal.columns.date}</Th>
                <Th>{ru.journal.columns.operation}</Th>
                <Th>{ru.journal.columns.asset}</Th>
                <Th align="right">{ru.journal.columns.quantityPrice}</Th>
                <Th align="right">{ru.journal.columns.amount}</Th>
                <Th>{ru.journal.columns.account}</Th>
                <Th>{ru.journal.columns.source}</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const qty =
                  r.instrumentKind === 'crypto' ? formatCrypto(r.quantity) : formatQuantity(r.quantity);
                const payout = ['dividend', 'coupon', 'interest', 'accrual'].includes(r.type);
                return (
                  <tr key={r.id} className="[&:last-child>td]:border-b-0">
                    <Td pad="tall" mono className="text-caption text-muted">
                      {formatDate(r.executedAt, tz)}
                    </Td>
                    <Td pad="tall">{ru.journal.types[r.type]}</Td>
                    <Td pad="tall">
                      {(() => {
                        const l = assetLabel({
                          kind: r.instrumentKind,
                          ticker: r.ticker,
                          name: r.instrumentName,
                        });
                        return (
                          <>
                            {l.code ? <span className="num text-caption">{l.code}</span> : null}{' '}
                            <span className={l.code ? 'text-muted' : undefined}>{l.name ?? ''}</span>
                          </>
                        );
                      })()}
                    </Td>
                    <Td
                      pad="tall"
                      align="right"
                      mono
                      className={cn('text-caption', r.quantity === '0' && 'text-muted')}
                    >
                      {r.quantity === '0' ? ru.common.none : `${qty} × ${formatTradeAmount(r.price)}`}
                    </Td>
                    <Td pad="tall" align="right" mono className={cn('text-caption', payout && 'text-gain')}>
                      {formatChange(Money.of(r.amount, r.currency))}
                    </Td>
                    <Td pad="tall">{r.accountName}</Td>
                    <Td pad="tall">
                      <Pill tone={r.origin === 'manual' ? 'neutral' : 'accent'} className="px-[9px] py-[3px]">
                        {ru.journal.origins[r.origin]}
                      </Pill>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
          {recent.map((r) => (
            <li
              key={r.id}
              className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">
                  {ru.journal.types[r.type]}{' '}
                  {assetLabel({ kind: r.instrumentKind, ticker: r.ticker, name: r.instrumentName }).code ??
                    r.instrumentName ??
                    ''}
                </span>
                <span className="text-small text-muted">
                  {formatDate(r.executedAt, tz)} · {r.accountName}
                </span>
              </span>
              <span className="num text-row whitespace-nowrap">
                {formatChange(Money.of(r.amount, r.currency))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
