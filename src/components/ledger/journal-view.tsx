import Link from 'next/link';
import { Pill } from '@/components/ui/pill';
import { Table, Td, Th } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { RowMenu } from './row-menu';
import type { TagOption } from './tag-select';

export interface JournalItem {
  id: string;
  date: string;
  /** Phone group heading: «5 октября». */
  day: string;
  typeLabel: string;
  ticker: string | null;
  assetName: string | null;
  quantityPrice: string | null;
  amount: string;
  amountTone: 'gain' | 'default';
  account: string;
  tag: string | null;
  tagId: string | null;
  origin: string;
  manual: boolean;
  accountId: string;
  instrumentId: string | null;
}

export interface TotalCell {
  label: string;
  value: string;
  tone: 'gain' | 'default';
}

const originTone = (origin: string) =>
  origin === 'manual' ? 'neutral' : origin === 'reconcile' ? 'warn' : 'accent';

function Totals({
  cells,
  layout,
  note,
}: {
  cells: TotalCell[];
  layout: 'wide' | 'phone';
  note: string | null;
}) {
  const cell = (c: TotalCell, size: string) => (
    <div key={c.label} className="flex flex-col gap-0.5">
      <span className="text-small text-muted">{c.label}</span>
      <span className={cn('num whitespace-nowrap', size, c.tone === 'gain' && 'text-gain')}>{c.value}</span>
    </div>
  );
  return (
    <>
      {layout === 'wide' ? (
        <div
          className="flex flex-wrap gap-x-8 gap-y-3 border-b border-border pb-4"
          data-testid="journal-totals"
        >
          {cells.map((c) => cell(c, 'text-body'))}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-border bg-surface px-4 py-3.5">
          {cells.map((c) => cell(c, 'text-row'))}
        </section>
      )}
      {note ? <div className="text-small text-muted">{note}</div> : null}
    </>
  );
}

export function JournalView({
  items,
  totals,
  phoneTotals,
  totalsNote,
  tags,
  pager,
}: {
  items: JournalItem[];
  totals: TotalCell[];
  phoneTotals: TotalCell[];
  totalsNote: string | null;
  tags: TagOption[];
  pager: React.ReactNode;
}) {
  const days = new Map<string, JournalItem[]>();
  for (const item of items) days.set(item.day, [...(days.get(item.day) ?? []), item]);
  const asset = (i: JournalItem) => [i.ticker, i.assetName].filter(Boolean).join(' ') || ru.common.none;

  return (
    <>
      {/* Wide: totals and the table in one card (Operations mockup). */}
      <section className="hidden flex-col gap-4 rounded-card border border-border bg-surface p-6 wide:flex">
        <Totals cells={totals} layout="wide" note={totalsNote} />
        <Table minWidth={900} data-testid="journal-table">
          <thead>
            <tr>
              <Th>{ru.journal.columns.date}</Th>
              <Th>{ru.journal.columns.operation}</Th>
              <Th>{ru.journal.columns.asset}</Th>
              <Th align="right">{ru.journal.columns.quantityPrice}</Th>
              <Th align="right">{ru.journal.columns.amount}</Th>
              <Th>{ru.journal.columns.account}</Th>
              <Th>{ru.journal.columns.tag}</Th>
              <Th>{ru.journal.columns.source}</Th>
              <Th align="right">
                <span className="sr-only">{ru.journal.columns.actions}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="[&:last-child>td]:border-b-0">
                <Td mono pad="tall" className="text-caption text-muted">
                  {i.date}
                </Td>
                <Td pad="tall">{i.typeLabel}</Td>
                <Td pad="tall">
                  {i.ticker ? <span className="num text-caption">{i.ticker}</span> : null}{' '}
                  <span className={i.ticker ? 'text-muted' : undefined}>
                    {i.assetName ?? (i.ticker ? '' : ru.common.none)}
                  </span>
                </Td>
                <Td
                  align="right"
                  mono
                  pad="tall"
                  className={cn('text-caption', !i.quantityPrice && 'text-muted')}
                >
                  {i.quantityPrice ?? ru.common.none}
                </Td>
                <Td
                  align="right"
                  mono
                  pad="tall"
                  className={cn('text-caption', i.amountTone === 'gain' && 'text-gain')}
                >
                  {i.amount}
                </Td>
                <Td pad="tall">{i.account}</Td>
                <Td pad="tall" className={i.tag ? 'text-text-2' : 'text-muted'}>
                  {i.tag ?? ru.common.none}
                </Td>
                <Td pad="tall">
                  <Pill tone={originTone(i.origin)} className="px-[9px] py-[3px]">
                    {ru.journal.origins[i.origin] ?? i.origin}
                  </Pill>
                </Td>
                <Td align="right" pad="none" className="pl-1">
                  <RowMenu
                    id={i.id}
                    manual={i.manual}
                    accountId={i.accountId}
                    instrumentId={i.instrumentId}
                    assetLabel={asset(i)}
                    tagId={i.tagId}
                    tags={tags}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {pager}
      </section>

      {/* Phone: totals card, then rows grouped by day (MOperations mockup). */}
      <div className="flex flex-col gap-3 wide:hidden">
        <Totals cells={phoneTotals} layout="phone" note={totalsNote} />
        <section
          className="flex flex-col rounded-card border border-border bg-surface px-4 py-1"
          data-testid="journal-list"
        >
          {[...days].map(([day, list]) => (
            <div key={day}>
              <h2 className="m-0 pt-3.5 pb-1 text-small font-medium text-muted">{day}</h2>
              {list.map((i) => (
                <Link
                  key={i.id}
                  href={`/operations/${i.id}/edit`}
                  className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border-subtle text-text no-underline last:border-b-0 hover:text-text"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">
                      {i.typeLabel} {i.ticker ?? i.assetName ?? ''}
                    </span>
                    <span className="truncate text-small text-muted">
                      {[i.quantityPrice, i.account, ru.journal.originsShort[i.origin]]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span
                    className={cn('num text-row whitespace-nowrap', i.amountTone === 'gain' && 'text-gain')}
                  >
                    {i.amount}
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </section>
        {pager}
      </div>
    </>
  );
}
