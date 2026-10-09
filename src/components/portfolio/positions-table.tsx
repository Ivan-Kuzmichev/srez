import { Table, Td, Th } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PriceButton } from './price-button';

function AssetName({
  href,
  className,
  children,
}: {
  href: string | null;
  className?: string;
  children: ReactNode;
}) {
  return href ? (
    <Link href={href} className={cn('text-text no-underline hover:text-accent-text', className)}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

export interface PositionItem {
  key: string;
  instrumentId: string;
  /** The asset page; cash has none. */
  href: string | null;
  ticker: string;
  name: string | null;
  account: string;
  assetClass: string;
  quantity: string;
  avg: string;
  price: string;
  value: string;
  share: string;
  result: string;
  tone: 'gain' | 'loss' | 'default';
  approx: boolean;
  /** Custom assets and anything without a quote can be valued by hand. */
  canSetPrice: boolean;
  currency: string;
}

/** Positions of a portfolio: a table on wide screens, a list on phones (Portfolio, MPortfolio mockups). */
export function PositionsTable({ items, count }: { items: PositionItem[]; count: number }) {
  const toneClass = (t: PositionItem['tone']) =>
    t === 'gain' ? 'text-gain' : t === 'loss' ? 'text-loss' : 'text-muted';
  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="positions"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{ru.portfolio.positionsTitle}</h2>
        <span className="hidden text-caption text-muted wide:inline">
          {ru.portfolio.positionsHint(count)}
        </span>
        <span className="text-caption text-muted wide:hidden">{ru.portfolio.positionsHintPhone(count)}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-caption text-muted">{ru.portfolio.noPositions}</div>
      ) : (
        <>
          <div className="hidden wide:block">
            <Table minWidth={860}>
              <thead>
                <tr>
                  <Th>{ru.portfolio.columns.asset}</Th>
                  <Th>{ru.portfolio.columns.class}</Th>
                  <Th align="right">{ru.portfolio.columns.quantity}</Th>
                  <Th align="right">{ru.portfolio.columns.avg}</Th>
                  <Th align="right">{ru.portfolio.columns.price}</Th>
                  <Th align="right">{ru.portfolio.columns.value}</Th>
                  <Th align="right">{ru.portfolio.columns.share}</Th>
                  <Th align="right">{ru.portfolio.columns.result}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.key} className="[&:last-child>td]:border-b-0">
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        <AssetName href={i.href}>
                          <span className="num text-caption font-medium">{i.ticker}</span>
                          {i.name ? <span className="text-muted"> {i.name}</span> : null}
                        </AssetName>
                        <span className="flex items-center gap-2 text-small text-muted">
                          {i.account}
                          {i.canSetPrice ? (
                            <PriceButton
                              instrumentId={i.instrumentId}
                              asset={i.ticker}
                              currency={i.currency}
                            />
                          ) : null}
                        </span>
                      </div>
                    </Td>
                    <Td className="text-text-2">{ru.classesShort[i.assetClass] ?? i.assetClass}</Td>
                    <Td align="right" mono className="text-caption">
                      {i.quantity}
                    </Td>
                    <Td align="right" mono className="text-caption text-muted">
                      {i.avg}
                    </Td>
                    <Td
                      align="right"
                      mono
                      className="text-caption"
                      title={i.approx ? ru.portfolio.approxHint : undefined}
                    >
                      {i.price}
                    </Td>
                    <Td align="right" mono className="text-caption">
                      {i.value}
                    </Td>
                    <Td align="right" mono className="text-caption text-muted">
                      {i.share}
                    </Td>
                    <Td align="right" mono className={cn('text-caption', toneClass(i.tone))}>
                      {i.result}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
            {items.map((i) => (
              <li
                key={i.key}
                className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <AssetName href={i.href} className="num truncate text-row font-medium">
                    {i.ticker}
                  </AssetName>
                  <span className="text-small text-muted">
                    {i.quantity} · {i.share}
                  </span>
                  {i.canSetPrice ? (
                    <PriceButton instrumentId={i.instrumentId} asset={i.ticker} currency={i.currency} />
                  ) : null}
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="num text-row whitespace-nowrap">{i.value}</span>
                  <span className={cn('num text-small whitespace-nowrap', toneClass(i.tone))}>
                    {i.result}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
