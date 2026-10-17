'use client';

import { useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface CompositionRow {
  key: string;
  label: string;
  /** «6 позиций, крупнейшая LKOH 8,9 %». */
  detail: string;
  /** Formatted by the server: «1 550 600 ₽», «32,2 %». */
  amount: string;
  shareText: string;
  /** Plot only. */
  share: number;
  /**
   * The color: a class keeps its own (stocks…cash), «Остальные» and «без отрасли» are neutral, the
   * rest take the class scale in order.
   */
  tone: 'stocks' | 'bonds' | 'funds' | 'crypto' | 'cash' | 'neutral' | number;
}

export interface CompositionView {
  /** «20 позиций на 4 812 360 ₽». */
  subtitle: string;
  rows: CompositionRow[];
}

/** The class scale, light to dark (docs/08-ui.md, section 1); neutral for the rest. */
const SCALE = ['stocks', 'bonds', 'funds', 'crypto', 'cash'] as const;
const SWATCH: Record<string, string> = {
  stocks: 'bg-class-stocks',
  bonds: 'bg-class-bonds',
  funds: 'bg-class-funds',
  crypto: 'bg-class-crypto',
  cash: 'bg-class-cash',
  neutral: 'bg-border-strong',
};
const swatch = (r: CompositionRow) =>
  SWATCH[typeof r.tone === 'number' ? SCALE[r.tone % SCALE.length]! : r.tone]!;

/** «Состав» (FR-ANL-10): a bar of shares and the groups under it, by classes or by sectors. */
export function CompositionCard({ views }: { views: Record<'classes' | 'sectors', CompositionView> }) {
  const [view, setView] = useState<'classes' | 'sectors'>('classes');
  const t = ru.composition;
  const { subtitle, rows } = views[view];
  return (
    <section
      className="flex min-w-0 flex-col gap-[18px] rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="composition"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-card font-semibold">{t.title}</h2>
          <span className="text-small text-muted">{subtitle}</span>
        </div>
        <Segmented
          aria-label={t.view}
          value={view}
          onValueChange={(v) => setView(v as typeof view)}
          options={Object.entries(t.views).map(([value, label]) => ({ value, label }))}
        />
      </div>
      {rows.length === 0 ? (
        <div className="text-caption text-muted">{view === 'sectors' ? t.noSectors : t.empty}</div>
      ) : (
        <>
          <div className="flex h-3 gap-[3px]" aria-hidden="true">
            {rows.map((r) => (
              <div
                key={r.key}
                className={cn('rounded-[3px]', swatch(r))}
                style={{ flex: `${r.share} 1 0` }}
              />
            ))}
          </div>
          <ul className="m-0 flex list-none flex-col p-0 text-row">
            {rows.map((r) => (
              <li
                key={r.key}
                className="flex min-h-[52px] items-center gap-3 border-t border-border-subtle py-1.5"
              >
                <span className={cn('size-2.5 shrink-0 rounded-[3px]', swatch(r))} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 wide:flex-row wide:items-baseline wide:gap-2">
                  <span className="font-medium whitespace-nowrap">{r.label}</span>
                  <span className="truncate text-small text-muted">{r.detail}</span>
                </span>
                <span className="num hidden text-caption whitespace-nowrap text-muted wide:inline">
                  {r.amount}
                </span>
                <span className="num w-16 text-right text-caption font-medium whitespace-nowrap">
                  {r.shareText}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
