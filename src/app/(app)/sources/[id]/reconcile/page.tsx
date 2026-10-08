import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FixedList } from '@/components/reconcile/fixed-list';
import { FixForm, type FixOption } from '@/components/reconcile/fix-form';
import { RecheckButton } from '@/components/reconcile/recheck-button';
import { db } from '@/db/client';
import type { Decimal } from '@/domain/decimal';
import { cn } from '@/lib/cn';
import {
  currencySymbol,
  formatDate,
  formatDateYear,
  formatPlain,
  formatQuantity,
  formatTradeAmount,
} from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { localDate } from '@/lib/time';
import { reconcileView, type DiscrepancyDetail, type DiscrepancyItem } from '@/server/reconcile';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.reconcile };

const MINUS = '−';
const signed = (v: Decimal, text: string) => `${v.gt(0) ? '+' : v.lt(0) ? MINUS : ''}${text}`;
const isCash = (i: Pick<DiscrepancyItem, 'kind'>) => i.kind === 'currency';
const qty = (i: Pick<DiscrepancyItem, 'kind'>, v: Decimal) =>
  isCash(i) ? formatPlain(v, 2) : formatQuantity(v);
const diffLabel = (i: DiscrepancyItem) =>
  signed(
    i.diff,
    isCash(i) ? formatPlain(i.diff.abs(), 2) : ru.reconcile.pieces(formatQuantity(i.diff.abs())),
  );
const title = (i: DiscrepancyItem) =>
  i.kind === 'bond' || !i.ticker ? { code: null, name: i.name } : { code: i.ticker, name: i.name };

function options(d: DiscrepancyDetail): FixOption[] {
  const q = formatQuantity(d.diff.abs());
  const more = d.diff.gt(0);
  const symbol = currencySymbol(d.currency);
  return d.fixes.map((fix): FixOption => {
    switch (fix) {
      case 'transfer':
        return {
          fix,
          label: more ? ru.reconcile.fixes.transferIn(q) : ru.reconcile.fixes.transferOut(q),
          date: true,
          price: more ? { label: ru.reconcile.priceTransfer(symbol), required: false } : null,
        };
      case 'trade':
        return {
          fix,
          label: more ? ru.reconcile.fixes.buy : ru.reconcile.fixes.sell,
          date: true,
          price: { label: ru.reconcile.priceTrade(symbol), required: true },
        };
      case 'split':
        return { fix, label: ru.reconcile.fixes.split, date: true, price: null };
      case 'cash': {
        const amount = `${formatPlain(d.diff.abs(), 2)} ${currencySymbol(d.ticker ?? d.currency)}`;
        return {
          fix,
          label: more ? ru.reconcile.fixes.deposit(amount) : ru.reconcile.fixes.withdrawal(amount),
          date: true,
          price: null,
        };
      }
      case 'redemption':
        return {
          fix,
          label: ru.reconcile.fixes.redemption(q),
          date: true,
          price: d.nominal ? null : { label: ru.reconcile.priceTrade(symbol), required: true },
        };
      case 'exclude':
        return { fix, label: ru.reconcile.fixes.exclude, date: false, price: null };
    }
  });
}

export default async function ReconcilePage({ params, searchParams }: PageProps<'/sources/[id]/reconcile'>) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const tz = getSettings(db(), session.user.id).display.timezone;
  const view = reconcileView(db(), session.user.id, id, Number(sp.d) || undefined);
  if (!view) notFound();
  const d = view.selected;
  const total = view.summary.matched + view.items.filter((i) => !isCash(i)).length;

  return (
    <>
      <header className="flex flex-col gap-3 wide:mb-2">
        <div className="hidden items-center gap-2 text-caption text-muted wide:flex">
          <Link href="/sources" className="no-underline">
            {ru.pages.sources}
          </Link>
          <span>/</span>
          <span>{ru.sources.tinvest}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 wide:gap-4">
          <div className="flex items-center gap-1">
            <Link
              href="/sources"
              aria-label={ru.reconcile.backToSources}
              className="-ml-3 flex size-11 items-center justify-center text-text wide:hidden"
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
            <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">
              <span className="wide:hidden">{ru.reconcile.titleShort}</span>
              <span className="max-wide:hidden">{ru.reconcile.title}</span>
            </h1>
          </div>
          <RecheckButton sourceId={view.sourceId} />
        </div>
        {view.items.length > 0 ? (
          <div className="text-pretty text-muted">
            <span className="wide:hidden">{ru.reconcile.leadShort(view.summary.matched, total)}</span>
            <span className="max-wide:hidden">{ru.reconcile.lead(view.summary.matched, total)}</span>
          </div>
        ) : null}
      </header>

      {view.items.length === 0 ? (
        <section
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="reconcile-none"
        >
          <h2 className="m-0 text-[18px] font-semibold">{ru.reconcile.none}</h2>
          <div className="text-caption text-muted">{ru.reconcile.noneText}</div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-start gap-3 wide:gap-4">
        <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-2">
          {view.items.length > 0 ? (
            <nav aria-label={ru.reconcile.title} className="flex flex-col gap-2" data-testid="reconcile-list">
              {view.items.map((i) => {
                const active = d?.id === i.id;
                const t = title(i);
                return (
                  <Link
                    key={i.id}
                    href={`?d=${i.id}`}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex flex-col gap-2 rounded-card border px-4 py-3.5 text-row text-text no-underline hover:text-text wide:px-[18px] wide:py-4',
                      active ? 'border-accent bg-surface-2' : 'border-border bg-surface',
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        {t.code ? (
                          <span className="num font-medium">{t.code}</span>
                        ) : (
                          <span className="font-medium">{t.name}</span>
                        )}
                        {t.code ? <span className="text-text-2"> {t.name}</span> : null}
                      </span>
                      <span className={cn('num whitespace-nowrap', i.diff.lt(0) ? 'text-loss' : 'text-gain')}>
                        {diffLabel(i)}
                      </span>
                    </span>
                    <span className="num text-caption text-muted max-wide:hidden">
                      {ru.reconcile.inJournal(qty(i, i.ledgerQty))} ·{' '}
                      {ru.reconcile.atBroker(qty(i, i.brokerQty))}
                    </span>
                    <span className="text-caption text-text-2">
                      <span className="wide:hidden">{ru.reconcile.guessShort[i.guess]}</span>
                      <span className="max-wide:hidden">{ru.reconcile.guess[i.guess]}</span>
                      {i.snoozed ? <span className="text-muted"> · {ru.reconcile.snoozed}</span> : null}
                    </span>
                  </Link>
                );
              })}
            </nav>
          ) : null}
          <FixedList
            items={view.fixed.map((f) => ({
              id: f.id,
              title: f.name,
              detail: `${ru.journal.types[f.operationType]} · ${f.accountName} · ${formatDate(f.resolvedAt, tz)}`,
            }))}
          />
        </div>

        {d ? (
          <section
            className="flex min-w-0 flex-[3_1_480px] flex-col gap-[22px] rounded-card border border-border bg-surface p-4 wide:p-6"
            data-testid="reconcile-detail"
          >
            <h2 className="m-0 text-[18px] font-semibold">
              <span className="wide:hidden">{ru.reconcile.detailTitleShort(d.name, d.accountName)}</span>
              <span className="max-wide:hidden">{ru.reconcile.detailTitle(d.name, d.accountName)}</span>
            </h2>
            <div className="flex flex-col wide:grid wide:grid-cols-[repeat(auto-fit,minmax(130px,1fr))] wide:gap-4">
              {[
                [
                  ru.reconcile.journal,
                  isCash(d) ? qty(d, d.ledgerQty) : ru.reconcile.pieces(qty(d, d.ledgerQty)),
                  '',
                ],
                [
                  ru.reconcile.broker,
                  isCash(d) ? qty(d, d.brokerQty) : ru.reconcile.pieces(qty(d, d.brokerQty)),
                  '',
                ],
                [
                  d.diff.gt(0) ? ru.reconcile.missing : ru.reconcile.extra,
                  isCash(d)
                    ? formatPlain(d.diff.abs(), 2)
                    : ru.reconcile.pieces(formatQuantity(d.diff.abs())),
                  'text-loss',
                ],
              ].map(([label, value, tone]) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 max-wide:min-h-11 max-wide:flex-row max-wide:items-center max-wide:justify-between max-wide:border-b max-wide:border-border-subtle"
                >
                  <span className="text-small text-muted max-wide:text-row">{label}</span>
                  <span className={cn('num wide:text-metric', tone)}>{value}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-small text-muted">{ru.reconcile.whatJournal}</span>
              {d.operations.length === 0 ? (
                <span className="text-caption text-muted">{ru.reconcile.journalEmpty}</span>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0" data-testid="reconcile-journal">
                  {d.operations.map((o) => (
                    <li
                      key={o.id}
                      className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle text-row last:border-b-0"
                    >
                      <span className="num w-24 text-caption text-muted">{formatDateYear(o.at, tz)}</span>
                      <span className="flex-1">{ru.journal.types[o.type]}</span>
                      <span className="num text-caption">
                        {o.quantity.isZero()
                          ? formatTradeAmount(o.amount)
                          : `${formatQuantity(o.quantity)} × ${formatTradeAmount(o.price)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {d.lastBrokerOperationAt ? (
                <span className="text-caption text-muted">
                  {ru.reconcile.lastBroker(formatDateYear(d.lastBrokerOperationAt, tz))}
                </span>
              ) : null}
            </div>
            <FixForm
              key={d.id}
              discrepancyId={d.id}
              options={options(d)}
              today={localDate(new Date(), tz)}
              snoozed={d.snoozed}
            />
          </section>
        ) : null}
      </div>
    </>
  );
}
