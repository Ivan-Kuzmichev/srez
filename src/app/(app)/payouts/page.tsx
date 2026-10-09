import { AccrualsBlock } from '@/components/payouts/accruals-block';
import { everything } from '@/domain/scope';
import { formatMonthYear } from '@/lib/format';
import { localDate } from '@/lib/time';
import { cryptoAccruals } from '@/server/accruals-data';
import { loadFx, portfolioScope } from '@/server/portfolio-data';
import { getSettings } from '@/server/settings';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PayoutsControls } from '@/components/payouts/controls';
import { PageHeader } from '@/components/shell/page-header';
import { db } from '@/db/client';
import type { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import {
  approx,
  formatChange,
  formatDate,
  formatMoney,
  formatPlain,
  formatQuantity,
  formatTradeAmount,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { payoutsView, type PayoutRow } from '@/server/payouts-data';
import { requireSession } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.payouts };

const rub = (v: Decimal) => formatMoney(Money.of(v, 'RUB'));
const day = (date: string) => formatDate(new Date(`${date}T12:00:00Z`), 'UTC');
const card = 'flex flex-col gap-1.5 rounded-card border border-border bg-surface px-6 py-5';
const metric = 'num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric';

function detail(r: PayoutRow): string {
  const kind = ru.payoutsPage.kinds[r.kind] ?? r.kind;
  const amount =
    r.quantity && r.perUnit
      ? `${kind}, ${formatQuantity(r.quantity)} × ${formatTradeAmount(r.perUnit)}`
      : kind;
  return r.account ? `${amount} · ${r.account}` : amount;
}

function Row({ r, received }: { r: PayoutRow; received: boolean }) {
  const amount = received ? formatChange(Money.of(r.amountRub, 'RUB')) : rub(r.amountRub);
  return (
    <li className="flex min-h-[60px] items-center gap-3 border-b border-border-subtle py-1.5 last:border-b-0 wide:gap-3.5">
      <span className="num w-[50px] shrink-0 text-small whitespace-nowrap text-muted wide:w-[58px] wide:text-caption">
        {day(r.date)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {r.instrumentId ? (
          <Link
            href={`/assets/${r.instrumentId}`}
            className="truncate font-medium text-text no-underline hover:text-accent-text"
          >
            {r.name}
          </Link>
        ) : (
          <span className="truncate font-medium">{r.name}</span>
        )}
        <span className="num truncate text-small text-muted">{detail(r)}</span>
      </span>
      <span className={cn('num text-row whitespace-nowrap', received && 'text-gain')}>
        {r.estimate ? approx(amount) : amount}
      </span>
    </li>
  );
}

/** «Выплаты» (Payouts, MPayouts; FR-PAY-1…6). */
export default async function PayoutsPage({ searchParams }: PageProps<'/payouts'>) {
  const session = await requireSession();
  const sp = await searchParams;
  const v = payoutsView(
    db(),
    session.user.id,
    Number(sp.year) || undefined,
    typeof sp.portfolio === 'string' ? sp.portfolio : undefined,
  );
  const tz = getSettings(db(), session.user.id).display.timezone;
  const crypto = cryptoAccruals(
    db(),
    session.user.id,
    v.portfolio ? portfolioScope(v.portfolio) : everything,
    loadFx(db()),
    String(v.year),
    tz,
  );
  const max = Math.max(...v.months.map((m) => m.received.plus(m.expected).toNumber()), 1);

  return (
    <>
      <PageHeader
        title={ru.pages.payouts}
        actions={
          <PayoutsControls
            portfolios={v.portfolios}
            portfolioId={v.portfolio?.id ?? null}
            years={v.years}
            year={v.year}
          />
        }
      />
      <div
        className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3 wide:gap-4"
        data-testid="payout-totals"
      >
        <section className={card}>
          <div className="text-caption text-muted">{ru.payoutsPage.received(v.year)}</div>
          <div className={cn(metric, 'text-gain')}>{formatChange(Money.of(v.received, 'RUB'))}</div>
          <div className="text-small text-muted">{ru.payoutsPage.receivedNote}</div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{ru.payoutsPage.expected}</div>
          <div className={metric}>{v.currentYear ? rub(v.expected) : ru.common.none}</div>
          <div className="text-small text-muted">
            {v.currentYear
              ? ru.payoutsPage.expectedNote(v.expectedCount, v.nearest ? day(v.nearest) : null)
              : ru.payoutsPage.pastYear}
          </div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">
            {v.currentYear ? ru.payoutsPage.forecast : ru.payoutsPage.forecastPast}
          </div>
          <div className={metric}>{rub(v.forecast)}</div>
          <div className="text-small text-muted">{ru.payoutsPage.perMonth(rub(v.perMonth))}</div>
        </section>
      </div>

      <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-card font-semibold">{ru.payoutsPage.months}</h2>
          <div className="flex flex-wrap gap-5 text-caption text-muted">
            <span className="flex items-center gap-2">
              <span className="size-3 rounded-[3px] bg-accent" />
              {ru.payoutsPage.receivedLegend}
            </span>
            <span className="flex items-center gap-2">
              <span className="size-3 rounded-[3px] border-[1.5px] border-dashed border-accent" />
              {ru.payoutsPage.expectedLegend}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div
            className="grid h-[210px] min-w-[480px] grid-cols-12 gap-2 border-b border-border pb-2"
            role="img"
            aria-label={ru.payoutsPage.monthsLabel(v.year)}
            data-testid="payout-months"
          >
            {v.months.map((m, i) => {
              const total = m.received.plus(m.expected);
              const h = (x: Decimal) => Math.max(x.isZero() ? 0 : 4, (x.toNumber() / max) * 170);
              return (
                <div key={i} className="flex flex-col items-center justify-end gap-1.5">
                  {total.gt(0) ? (
                    <span className="num text-small text-muted">{formatPlain(total.div(1000), 1)}</span>
                  ) : null}
                  {m.expected.gt(0) ? (
                    <div
                      className="w-full max-w-12 rounded-[4px] border-[1.5px] border-dashed border-accent"
                      style={{ height: `${h(m.expected)}px` }}
                    />
                  ) : null}
                  {m.received.gt(0) ? (
                    <div
                      className="w-full max-w-12 rounded-[4px] bg-accent"
                      style={{ height: `${h(m.received)}px` }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <div
            className="grid min-w-[480px] grid-cols-12 gap-2 pt-2 text-center text-small text-muted"
            aria-hidden="true"
          >
            {ru.payoutsPage.monthNames.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-3 wide:gap-4">
        {v.currentYear ? (
          <section
            className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
            data-testid="payouts-upcoming"
          >
            <h2 className="m-0 text-card font-semibold">{ru.payoutsPage.upcoming}</h2>
            {v.upcoming.length === 0 ? (
              <div className="text-caption text-muted">{ru.payoutsPage.upcomingEmpty}</div>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {v.upcoming.map((r, i) => (
                  <Row key={`${r.date}-${r.instrumentId}-${i}`} r={r} received={false} />
                ))}
              </ul>
            )}
          </section>
        ) : null}
        <section
          className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="payouts-recent"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.payoutsPage.recent}</h2>
            <Link href="/operations?type=payout&period=all" className="text-caption no-underline">
              {ru.payoutsPage.allInJournal}
            </Link>
          </div>
          {v.recent.length === 0 ? (
            <div className="text-caption text-muted">{ru.payoutsPage.recentEmpty}</div>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {v.recent.map((r, i) => (
                <Row key={`${r.date}-${r.instrumentId}-${i}`} r={r} received />
              ))}
            </ul>
          )}
        </section>
      </div>
      {crypto.rows.length > 0 ? (
        <AccrualsBlock
          rows={crypto.rows}
          total={crypto.totalYearRub}
          year={String(v.year)}
          monthName={formatMonthYear(localDate(new Date(), tz)).split('\u00a0')[0]!.toLowerCase()}
        />
      ) : null}
    </>
  );
}
