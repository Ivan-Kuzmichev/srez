import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { IconOperations, IconSources } from '@/components/icons';
import { JournalFilters, PhoneFiltersButton } from '@/components/ledger/journal-filters';
import { JournalView, type JournalItem, type TotalCell } from '@/components/ledger/journal-view';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { ActionTile, EmptyState } from '@/components/ui/empty-state';
import { db } from '@/db/client';
import { listAccounts, listTags } from '@/db/queries/accounts';
import {
  journalTotals,
  listJournal,
  listOrigins,
  PAGE_SIZE,
  PERIODS,
  TYPE_GROUPS,
  type JournalFilters as Filters,
  type JournalRow,
} from '@/db/queries/operations';
import { Money } from '@/domain/money';
import {
  formatChange,
  formatCrypto,
  formatDate,
  formatDateLong,
  formatQuantity,
  formatTradeAmount,
} from '@/lib/format';
import { assetLabel } from '@/lib/asset-label';
import { ru } from '@/lib/i18n/ru';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.operations };

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional()).catch(undefined);

/** Filters from the address bar; anything malformed falls back to the default. */
const Params = z.object({
  q: optional(z.string().max(64)),
  type: optional(z.enum(Object.keys(TYPE_GROUPS) as [keyof typeof TYPE_GROUPS])),
  account: optional(z.string().max(64)),
  source: optional(z.enum(['manual', 'tinvest', 'chain', 'reconcile'])),
  period: z.enum(PERIODS).catch('30d'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const PAYOUT_TYPES = new Set(['dividend', 'coupon', 'interest', 'accrual']);
const TRADE_TYPES = new Set([
  'buy',
  'sell',
  'transfer_in',
  'transfer_out',
  'fx_buy',
  'fx_sell',
  'redemption',
  'split',
  'accrual',
]);

function toItem(r: JournalRow, tz: string): JournalItem {
  const qty = r.instrumentKind === 'crypto' ? formatCrypto(r.quantity) : formatQuantity(r.quantity);
  return {
    id: r.id,
    date: formatDate(r.executedAt, tz),
    day: formatDateLong(r.executedAt, tz),
    typeLabel: ru.journal.types[r.type] ?? r.type,
    ...(() => {
      const l = assetLabel({ kind: r.instrumentKind, ticker: r.ticker, name: r.instrumentName });
      return { ticker: l.code, assetName: l.name };
    })(),
    quantityPrice:
      TRADE_TYPES.has(r.type) && r.quantity !== '0' ? `${qty} × ${formatTradeAmount(r.price)}` : null,
    amount: formatChange(Money.of(r.amount, r.currency)),
    amountTone: PAYOUT_TYPES.has(r.type) ? 'gain' : 'default',
    account: r.accountName,
    tag: r.tagName,
    tagId: r.tagId,
    origin: r.origin,
    manual: r.origin === 'manual',
    accountId: r.accountId,
    instrumentId: r.instrumentId,
  };
}

export default async function OperationsPage({ searchParams }: PageProps<'/operations'>) {
  const session = await requireSession();
  const userId = session.user.id;
  const p = Params.parse(await searchParams);
  const filters: Filters = { q: p.q, type: p.type, accountId: p.account, origin: p.source, period: p.period };
  const filtered = Boolean(p.q || p.type || p.account || p.source || p.period !== '30d');

  const { rows, total } = listJournal(db(), userId, filters, p.page);
  const accounts = listAccounts(db(), userId);
  const choices = {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    origins: listOrigins(db(), userId),
  };

  const header = (withFilters: boolean) => (
    <PageHeader
      title={ru.pages.operations}
      actions={
        <>
          {withFilters ? (
            <span className="wide:hidden">
              <PhoneFiltersButton choices={choices} />
            </span>
          ) : null}
          <Button asChild variant="primary" className="max-wide:size-11 max-wide:px-0">
            <Link href="/operations/new" aria-label={ru.journal.add}>
              <span className="hidden wide:inline">{ru.journal.add}</span>
              <span aria-hidden="true" className="text-[20px] leading-none wide:hidden">
                +
              </span>
            </Link>
          </Button>
        </>
      }
    />
  );

  // Nothing at all yet: OperationsEmpty.
  const anyOperations = total > 0 || filtered || listJournal(db(), userId, { period: 'all' }, 1).total > 0;
  if (!anyOperations) {
    return (
      <>
        {header(false)}
        <EmptyState
          title={ru.journal.emptyTitle}
          description={ru.journal.emptyText}
          actions={
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
              <ActionTile
                href="/sources"
                icon={<IconSources size={22} />}
                title={ru.journal.emptyConnect}
                description={ru.journal.emptyConnectText}
              />
              <ActionTile
                primary
                href="/operations/new"
                icon={<IconOperations size={22} />}
                title={ru.journal.emptyManual}
                description={ru.journal.emptyManualText}
              />
            </div>
          }
        />
      </>
    );
  }

  const t = journalTotals(db(), userId, filters);
  const money = (d: typeof t.deposits) => formatChange(Money.of(d, t.currency));
  const gain = (d: typeof t.deposits): TotalCell['tone'] => (d.gt(0) ? 'gain' : 'default');
  const totals: TotalCell[] = [
    { label: ru.journal.totals.deposits, value: money(t.deposits), tone: 'default' },
    { label: ru.journal.totals.buys, value: money(t.buys), tone: 'default' },
    { label: ru.journal.totals.sells, value: money(t.sells), tone: 'default' },
    { label: ru.journal.totals.payouts, value: money(t.payouts), tone: gain(t.payouts) },
    { label: ru.journal.totals.accruals, value: money(t.accruals), tone: gain(t.accruals) },
    { label: ru.journal.totals.fees, value: money(t.fees), tone: 'default' },
  ];
  const phoneTotals: TotalCell[] = [
    totals[0]!,
    totals[1]!,
    totals[2]!,
    {
      label: ru.journal.totals.payoutsAndAccruals,
      value: money(t.payouts.plus(t.accruals)),
      tone: gain(t.payouts.plus(t.accruals)),
    },
  ];

  const query = (page: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: p.q, type: p.type, account: p.account, source: p.source }))
      if (v) next.set(k, v);
    if (p.period !== '30d') next.set('period', p.period);
    if (page > 1) next.set('page', String(page));
    const s = next.toString();
    return s ? `/operations?${s}` : '/operations';
  };
  const shown = Math.min(total, (p.page - 1) * PAGE_SIZE + rows.length);
  const pager =
    total > 0 ? (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 max-wide:border-0 max-wide:pt-0">
        <span className="text-caption text-muted">{ru.journal.shown(shown, total)}</span>
        <div className="flex gap-2">
          <PagerLink href={p.page > 1 ? query(p.page - 1) : null}>{ru.journal.prev}</PagerLink>
          <PagerLink href={shown < total ? query(p.page + 1) : null}>{ru.journal.next}</PagerLink>
        </div>
      </div>
    ) : null;

  return (
    <>
      {header(true)}
      <JournalFilters choices={choices} />
      {rows.length === 0 ? (
        <EmptyState
          title={ru.journal.nothingFound}
          description={ru.journal.nothingFoundText}
          actions={
            <div>
              <Button asChild variant="secondary-raised">
                <Link href="/operations">{ru.journal.reset}</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <JournalView
          items={rows.map((r) => toItem(r, getSettings(db(), userId).display.timezone))}
          totals={totals}
          phoneTotals={phoneTotals}
          totalsNote={t.otherCurrency > 0 ? ru.journal.otherCurrency(t.otherCurrency) : null}
          tags={listTags(db(), userId)}
          pager={pager}
        />
      )}
    </>
  );
}

function PagerLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Button asChild variant="secondary-raised">
      <Link href={href} scroll={false}>
        {children}
      </Link>
    </Button>
  ) : (
    <Button variant="secondary" aria-disabled="true" disabled>
      {children}
    </Button>
  );
}
