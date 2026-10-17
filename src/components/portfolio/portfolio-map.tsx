'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { HEAT_RANGE, heatStep, squarify } from '@/domain/treemap';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

export interface MapTileView {
  key: string;
  href: string | null;
  /** «LKOH», a bond's name, «RUB». */
  title: string;
  /** «Лукойл»; null when the title says it all. */
  subtitle: string | null;
  /** «427 200 ₽». */
  valueText: string;
  share: number;
  /** Percent by period, plot only; null without history. */
  changes: Record<string, number | null>;
  /** «+2,4 %» by period, «—» without history. */
  changeTexts: Record<string, string>;
}

const PERIODS = ['1d', '1w', '1m', '6m', '1y', 'all'] as const;
type Period = (typeof PERIODS)[number];
const HEAT = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4', 'bg-heat-5', 'bg-heat-6'];

/**
 * «Карта портфеля» (Portfolio mockup; FR-PRT-11): a tile per position, its area the share, its color
 * the price change over the chosen period. A tile links to the asset; small tiles drop their amount,
 * the smallest their subtitle too.
 */
export function PortfolioMap({ tiles }: { tiles: MapTileView[] }) {
  const [period, setPeriod] = useState<Period>('1m');
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 340 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const rects = useMemo(
    () =>
      squarify(
        tiles.map((t) => t.share),
        size.w / Math.max(size.h, 1),
      ),
    [tiles, size.w, size.h],
  );
  const t = ru.portfolioMap;
  const range = HEAT_RANGE[period]!;

  return (
    <section
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="portfolio-map"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 className="m-0 text-card font-semibold">{t.title}</h2>
        <Segmented
          aria-label={t.period}
          value={period}
          onValueChange={(p) => setPeriod(p as Period)}
          options={PERIODS.map((p) => ({ value: p, label: t.periods[p]! }))}
        />
      </div>
      <div
        ref={box}
        role="list"
        aria-label={t.label(t.periodsLong[period]!)}
        className="relative h-[440px] wide:h-[340px]"
      >
        {rects.map((r) => {
          const tile = tiles[r.index]!;
          const change = tile.changes[period] ?? null;
          const step = change === null ? 3 : heatStep(change, range);
          const px = { w: (r.width / 100) * size.w, h: (r.height / 100) * size.h };
          const roomy = px.w > 120 && px.h > 110;
          const named = px.w > 150;
          const tiny = px.w < 56 || px.h < 48;
          // Too thin for padding and a border (they would stretch it past the map): a strip of color,
          // its figures in the tooltip.
          const sliver = px.w < 24 || px.h < 24;
          const body = sliver ? null : (
            <>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    'truncate leading-[1.1] font-semibold',
                    r.index === 0 && px.w > 180 ? 'text-section' : 'text-metric-phone',
                  )}
                >
                  {tile.title}
                  {tile.subtitle && named ? (
                    <span className="ml-1.5 text-small font-normal opacity-[0.72]">{tile.subtitle}</span>
                  ) : null}
                </span>
                {tiny ? null : <span className="num text-row">{tile.changeTexts[period]}</span>}
              </span>
              {roomy ? <span className="num text-small opacity-[0.72]">{tile.valueText}</span> : null}
            </>
          );
          const className = cn(
            'absolute box-border flex flex-col justify-between gap-1 overflow-hidden rounded-[6px] border border-surface px-3 py-2.5 text-text no-underline hover:text-text',
            HEAT[step],
            tiny && 'px-1.5 py-1',
            sliver && 'border-0 p-0',
          );
          const style = {
            left: `${r.left}%`,
            top: `${r.top}%`,
            width: `${r.width}%`,
            height: `${r.height}%`,
          };
          const title = t.tileTitle(
            tile.title,
            tile.subtitle,
            tile.changeTexts[period]!,
            t.periodsLong[period]!,
            tile.valueText,
          );
          return tile.href ? (
            <Link
              key={tile.key}
              role="listitem"
              href={tile.href}
              title={title}
              aria-label={title}
              className={className}
              style={style}
            >
              {body}
            </Link>
          ) : (
            <div
              key={tile.key}
              role="listitem"
              title={title}
              aria-label={title}
              className={className}
              style={style}
            >
              {body}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-small text-muted">
        <span>{t.legend(t.periodsLong[period]!)}</span>
        <span className="num flex items-center gap-2 whitespace-nowrap" aria-hidden="true">
          <span>{t.rangeMinus(range)}</span>
          <span className="flex gap-0.5">
            {HEAT.map((c) => (
              <span key={c} className={cn('h-2.5 w-5 rounded-[2px]', c)} />
            ))}
          </span>
          <span>{t.rangePlus(range)}</span>
        </span>
      </div>
    </section>
  );
}
