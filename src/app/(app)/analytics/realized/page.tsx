import type { Metadata } from 'next';
import Link from 'next/link';
import { AnalyticsHeader } from '@/components/analytics/header';
import { ParamSegmented, ParamSelect } from '@/components/analytics/param-controls';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Table, Td, Th } from '@/components/ui/table';
import { db } from '@/db/client';
import type { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import { formatChange, formatDate, formatHolding, formatPlain, formatQuantity } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { listPortfolios } from '@/server/portfolio-data';
import { realizedData, type RealizedRow } from '@/server/realized-data';
import { RealizedParams } from '@/server/realized-params';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.realized };

const card = 'flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5';
const metric = 'num text-metric font-medium tracking-[-0.01em] whitespace-nowrap';
const signed = (v: Decimal) => formatChange(Money.of(v.round(), 'RUB'));
const tone = (v: Decimal) => (v.gt(0) ? 'text-gain' : v.lt(0) ? 'text-loss' : undefined);
const plain = (v: Decimal) => formatPlain(v.abs().round(), 0);

/** «Прибыль за год» (Realized, MRealized; FR-ANL-8…10). */
export default async function RealizedPage({ searchParams }: PageProps<'/analytics/realized'>) {
  const session = await requireSession();
  const userId = session.user.id;
  const p = RealizedParams.parse(await searchParams);
  const tz = getSettings(db(), userId).display.timezone;
  const portfolios = listPortfolios(db(), userId);
  const selected = portfolios.find((x) => x.id === p.portfolio) ?? null;
  const r = realizedData(db(), userId, selected, tz, p.year ?? null, p.method);
  const s = r.summary;
  const t = ru.realized;
  const thisYear = r.years.at(-1) ?? r.year;
  const query = new URLSearchParams({
    ...(selected ? { portfolio: selected.id } : {}),
    year: r.year,
    method: r.method,
  });
  const csvHref = `/analytics/realized/export?${query}`;
  const feesTaxes = s.fees.plus(s.taxes).neg();
  const asset = (row: RealizedRow) => (
    <>
      {row.ticker && row.kind !== 'bond' ? (
        <span className="num text-caption font-medium">{row.ticker}</span>
      ) : null}
      {row.ticker && row.kind !== 'bond' ? ' ' : null}
      <span className={row.ticker && row.kind !== 'bond' ? 'text-text-2' : 'num text-caption font-medium'}>
        {row.name}
      </span>
    </>
  );
  const holding = (row: RealizedRow) => formatHolding(row.openedAt, row.closedAt);
  const day = (row: RealizedRow) => formatDate(row.closedAt, tz);

  return (
    <>
      <AnalyticsHeader
        portfolios={portfolios.map((x) => ({ id: x.id, name: x.name }))}
        portfolioId={selected?.id ?? null}
        actions={
          <ParamSegmented
            aria-label={t.year}
            name="year"
            value={r.year}
            fallback={thisYear}
            options={r.years.slice(-4).map((y) => ({ value: y, label: y }))}
          />
        }
      />

      <div
        className="grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4 max-wide:hidden wide:grid"
        data-testid="realized-cards"
      >
        <section className={card}>
          <div className="text-caption text-muted">{t.sales}</div>
          <div className={cn(metric, tone(s.sales))}>{signed(s.sales)}</div>
          <div className="text-small text-muted">{t.salesNote(signed(s.gains), signed(s.losses))}</div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{t.payouts}</div>
          <div className={cn(metric, tone(s.payouts))}>{signed(s.payouts)}</div>
          <div className="text-small text-muted">{t.payoutsNote}</div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{t.feesTaxes}</div>
          <div className={cn(metric, tone(feesTaxes))}>{signed(feesTaxes)}</div>
          <div className="text-small text-muted">{t.feesTaxesNote(plain(s.fees), plain(s.taxes))}</div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{t.total}</div>
          <div className={cn(metric, tone(s.total))} data-testid="realized-total">
            {signed(s.total)}
          </div>
          <div className="text-small text-muted">{t.totalNote}</div>
        </section>
      </div>

      <section
        className="flex flex-col gap-3.5 rounded-card border border-border bg-surface px-4 py-[18px] wide:hidden"
        data-testid="realized-summary"
      >
        <div className="flex flex-col gap-1">
          <div className="text-caption text-muted">{t.total}</div>
          <div
            className={cn('num text-[28px] font-medium tracking-[-0.02em] whitespace-nowrap', tone(s.total))}
          >
            {signed(s.total)}
          </div>
          <div className="text-small text-muted">{t.totalNote}</div>
        </div>
        <div className="flex flex-col border-t border-border pt-1.5">
          {[
            [t.sales, s.sales],
            [t.payouts, s.payouts],
            [t.feesTaxes, feesTaxes],
          ].map(([label, v]) => (
            <div
              key={label as string}
              className="flex min-h-11 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
            >
              <span className="text-muted">{label as string}</span>
              <span className={cn('num', tone(v as Decimal))}>{signed(v as Decimal)}</span>
            </div>
          ))}
        </div>
      </section>

      <section
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
        data-testid="realized-trades"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="m-0 text-card font-semibold">{t.trades}</h2>
          <span className="text-small text-muted wide:hidden">{t.methodShort[r.method]}</span>
          <div className="flex flex-wrap items-end gap-3 max-wide:hidden">
            <Field label={t.method} className="min-w-64">
              {(f) => (
                <ParamSelect
                  id={f.id}
                  name="method"
                  value={r.method}
                  fallback="fifo"
                  options={(['fifo', 'average'] as const).map((m) => ({ value: m, label: t.methods[m]! }))}
                />
              )}
            </Field>
            <Button asChild variant="secondary-raised">
              <a href={csvHref} download>
                {t.csv}
              </a>
            </Button>
          </div>
        </div>
        {r.rows.length === 0 ? (
          <div className="text-caption text-muted">{t.noTrades}</div>
        ) : (
          <>
            <div className="max-wide:hidden">
              <Table minWidth={860}>
                <thead>
                  <tr>
                    <Th>{t.columns.sold}</Th>
                    <Th>{t.columns.asset}</Th>
                    <Th align="right">{t.columns.quantity}</Th>
                    <Th align="right">{t.columns.bought}</Th>
                    <Th align="right">{t.columns.soldAt}</Th>
                    <Th>{t.columns.holding}</Th>
                    <Th align="right">{t.columns.result}</Th>
                    <Th>{t.columns.account}</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr key={`${row.saleId}${row.group}`} className="[&:last-child>td]:border-b-0">
                      <Td className="whitespace-nowrap text-text-2">{day(row)}</Td>
                      <Td className="whitespace-nowrap">
                        <Link
                          href={`/assets/${row.instrumentId}`}
                          className="text-text no-underline hover:text-text"
                        >
                          {asset(row)}
                        </Link>
                      </Td>
                      <Td align="right" mono>
                        {formatQuantity(row.quantity)}
                      </Td>
                      <Td align="right" mono className="text-muted">
                        {formatPlain(row.buyPrice, 2)}
                      </Td>
                      <Td align="right" mono>
                        {formatPlain(row.sellPrice, 2)}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {row.group === 'over3' ? <Pill tone="accent">{holding(row)}</Pill> : holding(row)}
                      </Td>
                      <Td align="right" mono className={tone(row.pnl)}>
                        {signed(row.pnl)}
                      </Td>
                      <Td className="whitespace-nowrap text-text-2">{row.accountName}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
              {r.rows.map((row) => (
                <li
                  key={`${row.saleId}${row.group}`}
                  className="flex min-h-[64px] items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">{asset(row)}</span>
                    <span className="text-small text-muted">
                      {day(row)} · {formatQuantity(row.quantity, { unit: row.assetClass !== 'crypto' })} ·{' '}
                      {holding(row)}
                    </span>
                  </span>
                  <span className={cn('num text-row whitespace-nowrap', tone(row.pnl))}>
                    {signed(row.pnl)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-3 wide:gap-4">
        {[
          {
            title: t.byClass,
            id: 'realized-classes',
            items: s.byClass.map((c) => ({
              key: c.assetClass,
              label: t.count(ru.classesShort[c.assetClass] ?? c.assetClass, c.trades),
              pnl: c.pnl,
            })),
          },
          {
            title: t.byHolding,
            id: 'realized-holding',
            items: s.byGroup.map((g) => ({
              key: g.group,
              label: t.count(t.groups[g.group]!, g.trades),
              pnl: g.pnl,
            })),
          },
        ].map((block) => (
          <section
            key={block.id}
            className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
            data-testid={block.id}
          >
            <h2 className="m-0 text-card font-semibold">{block.title}</h2>
            {block.items.length === 0 ? (
              <div className="text-caption text-muted">{t.noTrades}</div>
            ) : (
              <div className="flex flex-col">
                {block.items.map((i) => (
                  <div
                    key={i.key}
                    className="flex min-h-11 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
                  >
                    <span>{i.label}</span>
                    <span className={cn('num', tone(i.pnl))}>{signed(i.pnl)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <Button asChild variant="secondary-raised" className="wide:hidden">
        <a href={csvHref} download>
          {t.csv}
        </a>
      </Button>
    </>
  );
}
