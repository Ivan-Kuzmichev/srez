'use client';

import { useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface CompositionSlice {
  key: string;
  label: string;
  /** Formatted by the server: «128 400 ₽», «14,2 %». */
  amount: string;
  shareText: string;
  /** Plot only. */
  share: number;
  /**
   * The color: a class keeps its own (stocks…cash), «Остальное» and «без отрасли» are neutral, the
   * rest take the class scale in order.
   */
  tone: 'stocks' | 'bonds' | 'funds' | 'crypto' | 'cash' | 'neutral' | number;
}

/** The class scale, light to dark (docs/08-ui.md, section 1); neutral for the rest. */
const SCALE = ['stocks', 'bonds', 'funds', 'crypto', 'cash'] as const;
const FILL: Record<string, string> = {
  stocks: 'stroke-class-stocks',
  bonds: 'stroke-class-bonds',
  funds: 'stroke-class-funds',
  crypto: 'stroke-class-crypto',
  cash: 'stroke-class-cash',
  neutral: 'stroke-border-strong',
};
const SWATCH: Record<string, string> = {
  stocks: 'bg-class-stocks',
  bonds: 'bg-class-bonds',
  funds: 'bg-class-funds',
  crypto: 'bg-class-crypto',
  cash: 'bg-class-cash',
  neutral: 'bg-border-strong',
};
const toneOf = (s: CompositionSlice) => (typeof s.tone === 'number' ? SCALE[s.tone % SCALE.length]! : s.tone);
const color = (s: CompositionSlice, kind: 'fill' | 'swatch') => (kind === 'fill' ? FILL : SWATCH)[toneOf(s)]!;
/** The middle of the ring fits about fourteen characters. */
const short = (label: string) => (label.length > 14 ? `${label.slice(0, 13)}…` : label);

const R = 70;
const W = 26;
const C = 90;

function arc(from: number, to: number): string {
  // A whole ring: two halves, an arc from a point to itself draws nothing.
  if (to - from > 0.999) return `M${C} ${C - R}A${R} ${R} 0 1 1 ${C} ${C + R}A${R} ${R} 0 1 1 ${C} ${C - R}`;
  const a = from * 2 * Math.PI - Math.PI / 2;
  const b = to * 2 * Math.PI - Math.PI / 2;
  const large = to - from > 0.5 ? 1 : 0;
  const p = (t: number) => `${(C + R * Math.cos(t)).toFixed(2)} ${(C + R * Math.sin(t)).toFixed(2)}`;
  return `M${p(a)}A${R} ${R} 0 ${large} 1 ${p(b)}`;
}

/**
 * «Состав» (FR-ANL-10): a ring of the largest holdings, the classes or the sectors. Hovering a slice or
 * its legend row (or focusing the row) shows its amount in the middle.
 */
export function CompositionChart({
  views,
  total,
}: {
  views: Record<'assets' | 'classes' | 'sectors', CompositionSlice[]>;
  /** «2,95 млн ₽». */
  total: string;
}) {
  const [view, setView] = useState<'assets' | 'classes' | 'sectors'>('assets');
  const [active, setActive] = useState<string | null>(null);
  const t = ru.composition;
  const slices = views[view];
  const sum = slices.reduce((s, x) => s + x.share, 0) || 1;
  const gap = slices.length > 1 ? 0.004 : 0;
  // Where each slice starts: the shares before it, as a fraction of the ring.
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((a, x) => a + x.share, 0) / sum);
  const arcs = slices.map((s, i) => {
    const from = starts[i]!;
    const to = from + s.share / sum;
    return { s, d: arc(from, Math.max(from, to - gap)) };
  });
  const shown = slices.find((s) => s.key === active) ?? null;

  return (
    <section
      className="flex min-w-0 flex-col gap-[18px] rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="composition"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{t.title}</h2>
        <Segmented
          aria-label={t.view}
          value={view}
          onValueChange={(v) => {
            setView(v as typeof view);
            setActive(null);
          }}
          options={Object.entries(t.views).map(([value, label]) => ({ value, label }))}
        />
      </div>
      {slices.length === 0 ? (
        <div className="text-caption text-muted">{view === 'sectors' ? t.noSectors : t.empty}</div>
      ) : (
        <div className="flex flex-wrap items-center gap-7">
          <svg
            viewBox="0 0 180 180"
            className="mx-auto size-[180px] shrink-0 wide:mx-0"
            role="img"
            aria-label={t.label(slices.map((s) => `${s.label} ${s.shareText}`).join(', '))}
          >
            {arcs.map(({ s, d }) => (
              <path
                key={s.key}
                d={d}
                fill="none"
                strokeWidth={active === s.key ? W + 4 : W}
                className={cn(color(s, 'fill'), 'cursor-pointer transition-[stroke-width]')}
                onPointerEnter={() => setActive(s.key)}
                onPointerLeave={() => setActive(null)}
              />
            ))}
            <text x={C} y={C - 6} textAnchor="middle" className="fill-muted text-small">
              {shown ? short(shown.label) : t.total}
            </text>
            <text x={C} y={C + 14} textAnchor="middle" className="num fill-text text-caption">
              {shown ? shown.amount : total}
            </text>
          </svg>
          <ul className="m-0 flex min-w-0 flex-[1_1_220px] list-none flex-col p-0 text-row">
            {slices.map((s) => (
              <li
                key={s.key}
                tabIndex={0}
                onPointerEnter={() => setActive(s.key)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(s.key)}
                onBlur={() => setActive(null)}
                className={cn(
                  'flex min-h-11 items-center gap-2.5 rounded-nav border-b border-border-subtle px-1 last:border-b-0',
                  active === s.key && 'bg-surface-2',
                )}
              >
                <span
                  className={cn('size-2.5 shrink-0 rounded-[3px]', color(s, 'swatch'))}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="num text-caption whitespace-nowrap">{s.shareText}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
