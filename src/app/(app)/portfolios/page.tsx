import type { Metadata } from 'next';
import Link from 'next/link';
import { ClassBar, ClassLegend } from '@/components/portfolio/class-legend';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Table, Td, Th } from '@/components/ui/table';
import { db } from '@/db/client';
import { listAccounts } from '@/db/queries/accounts';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import { approx, formatMoney, formatPercent } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import {
  listPortfolios,
  loadFx,
  loadUserLedger,
  loadValuedCells,
  portfolioScope,
  areaMetrics,
  primaryReturn,
  summarizeArea,
  tagNames,
} from '@/server/portfolio-data';
import { describeRules } from '@/server/portfolio-text';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.portfolios };

const rub = (v: Decimal, isApprox = false) => {
  const text = formatMoney(Money.of(v, 'RUB'));
  return isApprox ? approx(text) : text;
};

export default async function PortfoliosPage() {
  const session = await requireSession();
  const userId = session.user.id;
  const settings = getSettings(db(), userId);
  const tz = settings.display.timezone;
  const fx = loadFx(db());
  const cells = loadValuedCells(db(), userId, fx);
  const ledger = loadUserLedger(db(), userId);
  const portfolios = listPortfolios(db(), userId);
  const accounts = listAccounts(db(), userId);
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const tags = tagNames(db(), userId);

  const header = (
    <PageHeader
      title={ru.portfolios.title}
      actions={
        <Button asChild variant="primary">
          <Link href="/portfolios/new">{ru.portfolios.add}</Link>
        </Button>
      }
    />
  );

  const cards = portfolios.map((p) => {
    const s = summarizeArea(db(), userId, portfolioScope(p), cells, ledger, fx, tz, null);
    const x = primaryReturn(
      areaMetrics(db(), userId, portfolioScope(p), cells, ledger, fx, settings, p.benchmarkId),
    );
    return { p, s, x, positions: s.cells.filter((c) => !c.isCash).length };
  });

  return (
    <>
      {header}
      {portfolios.length === 0 ? (
        <EmptyState
          title={ru.portfolios.empty}
          description={ru.portfolios.emptyText}
          actions={
            <div>
              <Button asChild variant="primary">
                <Link href="/portfolios/new">{ru.portfolios.add}</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <ClassLegend />
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3 wide:gap-4"
            data-testid="portfolio-cards"
          >
            {cards.map(({ p, s, x, positions }) => (
              <Link
                key={p.id}
                href={`/portfolios/${p.id}`}
                className="flex flex-col gap-4 rounded-card border border-border bg-surface p-[22px] text-text no-underline hover:text-text"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-card font-semibold">{p.name}</span>
                  {x ? (
                    <span
                      title={
                        settings.returns.primaryMetric === 'twr'
                          ? ru.portfolios.returnHintTwr
                          : ru.portfolios.returnHint
                      }
                      className={cn(
                        'num text-caption whitespace-nowrap',
                        x.rate.gte(0) ? 'text-gain' : 'text-loss',
                      )}
                    >
                      {formatPercent(x.rate.times(100), { signed: true })}
                    </span>
                  ) : null}
                </span>
                <span className="num text-[22px] font-medium tracking-[-0.01em] whitespace-nowrap">
                  {rub(s.value, s.approx)}
                </span>
                <ClassBar
                  shares={s.classes.map((c) => ({ assetClass: c.assetClass, share: c.share.toNumber() }))}
                />
                <span className="text-small text-muted">
                  {describeRules(p, accountNames, tags)} · {ru.portfolios.positions(positions)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {accounts.length > 0 ? (
        <section
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="accounts-table"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="m-0 text-card font-semibold">{ru.portfolios.accountsTitle}</h2>
            <span className="text-caption text-muted">{ru.portfolios.accountsText}</span>
          </div>
          <Table minWidth={600}>
            <thead>
              <tr>
                <Th>{ru.portfolios.columns.account}</Th>
                <Th>{ru.portfolios.columns.source}</Th>
                <Th align="right">{ru.portfolios.columns.value}</Th>
                <Th>{ru.portfolios.columns.member}</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const own = cells.filter((c) => c.accountId === a.id);
                const value = own.reduce((sum, c) => sum.plus(c.valueRub), new Decimal(0));
                const member = portfolios.flatMap((p) =>
                  p.rules
                    .filter((r) => r.accountId === a.id)
                    .map((r) =>
                      r.mode === 'tag'
                        ? ru.portfolios.memberTag(p.name, tags.get(r.tagId ?? '') ?? '')
                        : p.name,
                    ),
                );
                return (
                  <tr key={a.id} className="[&:last-child>td]:border-b-0">
                    <Td pad="tall" className="font-medium">
                      {a.name}
                    </Td>
                    <Td pad="tall">
                      <Pill
                        tone={a.sourceKind === 'manual' ? 'neutral' : 'accent'}
                        className="px-[9px] py-[3px]"
                      >
                        {ru.journal.origins[a.sourceKind === 'manual' ? 'manual' : 'tinvest']}
                      </Pill>
                    </Td>
                    <Td pad="tall" align="right" mono>
                      {rub(
                        value,
                        own.some((c) => c.approx),
                      )}
                    </Td>
                    <Td
                      pad="tall"
                      className={cn('whitespace-normal', member.length ? 'text-text-2' : 'text-muted')}
                    >
                      {member.length ? member.join(' · ') : ru.portfolios.notInAny}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      ) : null}
    </>
  );
}
