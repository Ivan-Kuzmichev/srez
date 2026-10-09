import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { AnalyticsHeader } from '@/components/analytics/header';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, Td, Th } from '@/components/ui/table';
import { db } from '@/db/client';
import { Decimal } from '@/domain/decimal';
import { Money } from '@/domain/money';
import { cn } from '@/lib/cn';
import {
  approx,
  formatChange,
  formatDate,
  formatMoney,
  formatMonthAxis,
  formatPercent,
  formatPlain,
  formatQuantity,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { bondsData } from '@/server/bonds-data';
import { listPortfolios } from '@/server/portfolio-data';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.bonds };

const Params = z.object({ portfolio: z.string().max(64).optional().catch(undefined) });
const card =
  'flex flex-col gap-1.5 rounded-card border border-border bg-surface px-4 py-4 wide:px-6 wide:py-5';
const metric = 'num text-metric-phone font-medium tracking-[-0.01em] whitespace-nowrap wide:text-metric';
const rub = (v: Decimal) => formatMoney(Money.of(v.round(), 'RUB'));
const month = (date: string) => `${formatMonthAxis(date)} ${date.slice(0, 4)}`;

/** «Облигации» (Bonds, MBonds; FR-ANL-6, 7). */
export default async function BondsPage({ searchParams }: PageProps<'/analytics/bonds'>) {
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
  const b = bondsData(db(), userId, selected, settings);
  if (b.rows.length === 0)
    return (
      <>
        {header}
        <EmptyState title={ru.bondsPage.empty} />
      </>
    );

  const t = ru.bondsPage;
  const pct1 = (v: Decimal) => formatPercent(v.toFixed(1));
  const years = (v: Decimal) => t.years(formatPlain(v, 1), v.toDecimalPlaces(1).toNumber() === 1 ? 1 : 2);
  const ytmText = (r: (typeof b.rows)[number]) =>
    r.ytm ? `${r.approx ? '≈ ' : ''}${pct1(r.ytm.times(100))}` : ru.common.none;
  const shockPct = b.value.isZero() ? new Decimal(0) : b.shock.div(b.value).times(100);
  const thousands = (v: Decimal) => v.div(1000).round().times(1000);
  const maxRedemption = b.redemptions.reduce((m, r) => Decimal.max(m, r.amount), new Decimal(0));
  const day = (date: string) => formatDate(new Date(`${date}T12:00:00Z`), 'UTC');
  const assetHref = (id: string) => `/assets/${id}${selected ? `?portfolio=${selected.id}` : ''}`;

  return (
    <>
      {header}
      <div
        className="grid grid-cols-2 gap-3 wide:grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] wide:gap-4"
        data-testid="bonds-cards"
      >
        <section className={card}>
          <div className="text-caption text-muted">
            <span className="wide:hidden">{t.valueShort}</span>
            <span className="max-wide:hidden">{t.value}</span>
          </div>
          <div className={metric}>{rub(b.value)}</div>
          <div className="text-small text-muted">
            <span className="wide:hidden">{t.valueNoteShort(pct1(b.capitalShare))}</span>
            <span className="max-wide:hidden">{t.valueNote(pct1(b.capitalShare), b.rows.length)}</span>
          </div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">
            <span className="wide:hidden">{t.ytmShort}</span>
            <span className="max-wide:hidden">{t.ytm}</span>
          </div>
          <div className={metric}>{b.ytm ? pct1(b.ytm.times(100)) : ru.common.none}</div>
          <div className="text-small text-muted">
            <span className="wide:hidden">{t.ytmNoteShort}</span>
            <span className="max-wide:hidden">{t.ytmNote}</span>
          </div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">{t.duration}</div>
          <div className={metric}>{b.duration ? years(b.duration) : ru.common.none}</div>
          <div className="text-small text-muted">
            <span className="wide:hidden">{t.durationNoteShort}</span>
            <span className="max-wide:hidden">{t.durationNote}</span>
          </div>
        </section>
        <section className={card}>
          <div className="text-caption text-muted">
            <span className="wide:hidden">{t.couponsShort}</span>
            <span className="max-wide:hidden">{t.coupons}</span>
          </div>
          <div className={metric}>{b.couponsApprox ? approx(rub(b.couponsYear)) : rub(b.couponsYear)}</div>
          <div className="text-small text-muted">
            <span className="wide:hidden">{t.couponsNoteShort}</span>
            <span className="max-wide:hidden">
              {b.floatingShare.gt(0) ? t.couponsNoteFloat : t.couponsNote}
            </span>
          </div>
        </section>
      </div>

      <section
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
        data-testid="bonds-issues"
      >
        <h2 className="m-0 text-card font-semibold">{t.issues}</h2>
        <div className="max-wide:hidden">
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>{t.columns.issue}</Th>
                <Th align="right">{t.columns.quantity}</Th>
                <Th align="right">{t.columns.price}</Th>
                <Th align="right">{t.columns.value}</Th>
                <Th align="right">{t.columns.coupon}</Th>
                <Th align="right">{t.columns.ytm}</Th>
                <Th align="right">{t.columns.duration}</Th>
                <Th>{t.columns.maturity}</Th>
                <Th>{t.columns.portfolios}</Th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.instrumentId} className="[&:last-child>td]:border-b-0">
                  <Td mono className="font-medium whitespace-nowrap">
                    <Link href={assetHref(r.instrumentId)} className="text-text no-underline hover:text-text">
                      {r.name}
                    </Link>
                  </Td>
                  <Td align="right" mono>
                    {formatQuantity(r.quantity)}
                  </Td>
                  <Td align="right" mono>
                    {r.pricePct ? formatPlain(r.pricePct, 2) : ru.common.none}
                  </Td>
                  <Td align="right" mono>
                    {formatPlain(r.value.round(), 0)}
                  </Td>
                  <Td align="right" mono className="text-muted">
                    {r.floating
                      ? t.floating
                      : r.couponPct
                        ? formatPercent(r.couponPct.toFixed(2), { digits: 2 })
                        : ru.common.none}
                  </Td>
                  <Td align="right" mono title={r.noSchedule ? t.noSchedule : undefined}>
                    {r.noSchedule ? <span className="text-muted">{t.noSchedule}</span> : ytmText(r)}
                  </Td>
                  <Td align="right" mono>
                    {r.duration ? formatPlain(r.duration, 1) : ru.common.none}
                  </Td>
                  <Td className="whitespace-nowrap text-text-2">
                    {r.maturityDate ? month(r.maturityDate) : ru.common.none}
                  </Td>
                  <Td className="whitespace-nowrap text-text-2">
                    {r.portfolios.join(', ') || ru.common.none}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
          {b.rows.map((r) => (
            <li
              key={r.instrumentId}
              className="flex min-h-[72px] items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={assetHref(r.instrumentId)}
                  className="num text-caption font-medium text-text no-underline hover:text-text"
                >
                  {r.name}
                </Link>
                <span className="text-small text-muted">
                  {t.phoneLine(
                    formatQuantity(r.quantity),
                    r.floating
                      ? t.floating
                      : r.couponPct
                        ? t.phoneCoupon(formatPercent(r.couponPct.toFixed(2), { digits: 2 }))
                        : ru.common.none,
                    r.maturityDate ? month(r.maturityDate) : ru.common.none,
                  )}
                </span>
                {r.portfolios.length ? (
                  <span className="text-small text-muted">{r.portfolios.join(', ')}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="num text-row">{rub(r.value)}</span>
                <span className="num text-small text-muted">
                  {r.noSchedule
                    ? t.noSchedule
                    : t.phoneYield(ytmText(r), r.duration ? formatPlain(r.duration, 1) : ru.common.none)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-start gap-3 wide:gap-4">
        <section
          className="flex min-w-0 flex-[3_1_440px] flex-col gap-[18px] rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="bonds-redemptions"
        >
          <h2 className="m-0 text-card font-semibold">{t.redemptions}</h2>
          <div className="flex flex-col gap-3 text-row">
            {b.redemptions.map((r) => (
              <div key={r.year} className="flex items-center gap-3.5">
                <span className="num w-10 text-caption text-muted">{r.year}</span>
                <div className="h-3 flex-1 rounded-[4px] bg-track">
                  <div
                    className="h-full rounded-[4px] bg-accent"
                    style={{
                      width: `${maxRedemption.isZero() ? 0 : r.amount.div(maxRedemption).times(100).toNumber()}%`,
                    }}
                  />
                </div>
                <span className="num w-[84px] text-right text-caption whitespace-nowrap">
                  <span className="wide:hidden">{formatPlain(r.amount.round(), 0)}</span>
                  <span className="max-wide:hidden">{rub(r.amount)}</span>
                </span>
              </div>
            ))}
          </div>
          {b.soon.length === 0 ? (
            <div className="rounded-control bg-surface-2 px-4 py-3.5 text-caption text-pretty text-text-2">
              <span className="wide:hidden">{t.soonNoneShort}</span>
              <span className="max-wide:hidden">{t.soonNone}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1 rounded-control bg-surface-2 px-4 py-3.5 text-caption text-text-2">
              <span className="text-muted">{t.soonTitle}</span>
              {b.soon.map((e) => (
                <span key={`${e.date}${e.name}${e.kind}`} className="flex justify-between gap-3">
                  <span>
                    {day(e.date)}, {e.name}, {t.soonKinds[e.kind] ?? e.kind}
                  </span>
                  <span className="num">{rub(e.amount)}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        <section
          className="flex min-w-0 flex-[2_1_340px] flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="bonds-rates"
        >
          <h2 className="m-0 text-card font-semibold">{t.rates}</h2>
          <div className="flex flex-col">
            {[
              { label: t.rateUp, amount: b.shock, share: shockPct },
              { label: t.rateDown, amount: b.shock.neg(), share: shockPct.neg() },
            ].map((x) => (
              <div
                key={x.label}
                className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
              >
                <span>{x.label}</span>
                <span
                  className={cn(
                    'num text-row whitespace-nowrap',
                    x.amount.lt(0) ? 'text-loss' : x.amount.gt(0) && 'text-gain',
                  )}
                >
                  {approx(formatChange(Money.of(thousands(x.amount), 'RUB')))} ·{' '}
                  {formatPercent(x.share.toFixed(1), { signed: true })}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2.5 border-t border-border pt-4">
            <span className="text-small text-muted max-wide:hidden">{t.couponType}</span>
            <div className="flex h-3 gap-[3px]" aria-hidden="true">
              {b.floatingShare.lt(100) ? (
                <div
                  className="rounded-[3px] bg-class-bonds"
                  style={{ flex: `${new Decimal(100).minus(b.floatingShare).toNumber()} 1 0` }}
                />
              ) : null}
              {b.floatingShare.gt(0) ? (
                <div
                  className="rounded-[3px] bg-class-cash"
                  style={{ flex: `${b.floatingShare.toNumber()} 1 0` }}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-caption">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-[3px] bg-class-bonds" aria-hidden="true" />
                <span className="wide:hidden">
                  {t.fixedShort(pct1(new Decimal(100).minus(b.floatingShare)))}
                </span>
                <span className="max-wide:hidden">
                  {t.fixed(pct1(new Decimal(100).minus(b.floatingShare)))}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-[3px] bg-class-cash" aria-hidden="true" />
                <span>{t.float(pct1(b.floatingShare))}</span>
              </div>
            </div>
          </div>
          <div className="text-caption text-pretty text-muted max-wide:hidden">{t.ratesNote}</div>
        </section>
      </div>
    </>
  );
}
