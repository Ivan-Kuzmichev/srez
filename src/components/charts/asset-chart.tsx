'use client';

import { useMemo, useRef, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { formatDate as formatDay, formatTradeAmount } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';

const PERIODS = ['6m', '1y', 'buy'] as const;
type Period = (typeof PERIODS)[number];
const W = 800;
const H = 220;
const PAD = 14;

export interface AssetMarkerPoint {
  date: string;
  kind: 'buy' | 'sell' | 'payout';
}

/**
 * Price with trades and payouts (Asset mockup): the close line, the average price dashed, circles for
 * purchases and sales, squares for payouts, each on the price of its day.
 */
export function AssetChart({
  points,
  avg,
  markers,
  firstBuy,
  label,
}: {
  points: { date: string; price: number }[];
  /** Plot coordinate of the average price, in the chart's currency; null hides the line. */
  avg: number | null;
  markers: AssetMarkerPoint[];
  firstBuy: string | null;
  label: string;
}) {
  const [period, setPeriod] = useState<Period>('buy');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const shown = useMemo(() => {
    if (points.length === 0) return points;
    const last = Date.parse(`${points.at(-1)!.date}T00:00:00Z`);
    const from =
      period === 'buy'
        ? (firstBuy ?? points[0]!.date)
        : new Date(last - (period === '6m' ? 183 : 366) * 86_400_000).toISOString().slice(0, 10);
    return points.filter((p) => p.date >= from);
  }, [points, period, firstBuy]);

  const geo = useMemo(() => {
    const values = [...shown.map((p) => p.price), ...(avg !== null ? [avg] : [])];
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const x = (i: number) => (shown.length <= 1 ? W / 2 : (i / (shown.length - 1)) * W);
    const y = (v: number) => PAD + (1 - (v - min) / span) * (H - 2 * PAD);
    const line = shown.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.price).toFixed(1)}`).join('');
    // A marker sits on the first price on or after its day.
    const dots = markers
      .map((m) => ({ ...m, i: shown.findIndex((p) => p.date >= m.date) }))
      .filter((m) => m.i >= 0 && m.date >= (shown[0]?.date ?? ''));
    return { x, y, line, dots };
  }, [shown, avg, markers]);

  const point = hover !== null ? shown[hover] : null;
  const pick = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || shown.length === 0) return;
    setHover(Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (shown.length - 1)));
  };
  const day = (date: string) => formatDay(new Date(`${date}T12:00:00Z`), 'UTC');
  const tickCount = Math.min(6, shown.length);
  const ticks =
    shown.length < 2
      ? []
      : Array.from({ length: tickCount }, (_, k) => Math.round((k * (shown.length - 1)) / (tickCount - 1)));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-caption text-muted">
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-[18px] rounded-sm bg-accent" />
            {ru.asset.price}
          </span>
          {avg !== null ? (
            <span className="flex items-center gap-2">
              <span className="h-0 w-[18px] border-t-[1.5px] border-dashed border-muted" />
              {ru.asset.avg(formatTradeAmount(avg.toString()))}
            </span>
          ) : null}
          <span className="flex items-center gap-2">
            <span className="size-3 rounded-full border-2 border-surface bg-text" />
            {ru.asset.buy}
          </span>
          <span className="flex items-center gap-2">
            <span className="size-[11px] rounded-[2px] border-2 border-gain bg-surface" />
            {ru.asset.payout}
          </span>
        </div>
        <Segmented
          aria-label={ru.chart.period}
          value={period}
          onValueChange={(p) => {
            setPeriod(p as Period);
            setHover(null);
          }}
          options={PERIODS.map((p) => ({ value: p, label: ru.asset.periods[p]! }))}
        />
      </div>
      {shown.length < 2 ? (
        <div className="flex h-[230px] items-center justify-center rounded-control bg-surface-2 text-caption text-muted">
          {ru.chart.empty}
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            tabIndex={0}
            className="block h-[230px] w-full cursor-crosshair touch-none"
            onPointerMove={(e) => pick(e.clientX)}
            onPointerLeave={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? shown.length) - 1));
              if (e.key === 'ArrowRight') setHover((h) => Math.min(shown.length - 1, (h ?? -1) + 1));
              if (e.key === 'Escape') setHover(null);
            }}
            onBlur={() => setHover(null)}
          >
            {avg !== null ? (
              <path
                d={`M0 ${geo.y(avg)}H${W}`}
                className="stroke-muted"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                vectorEffect="non-scaling-stroke"
                fill="none"
              />
            ) : null}
            <path
              d={geo.line}
              fill="none"
              className="stroke-accent"
              strokeWidth={2.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {point && hover !== null ? (
              <path
                d={`M${geo.x(hover)} 0V${H}`}
                className="stroke-border-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {geo.dots.map((m, k) => (
            <span
              key={`${m.date}-${m.kind}-${k}`}
              aria-hidden="true"
              data-marker={m.kind}
              className={
                m.kind === 'payout'
                  ? 'pointer-events-none absolute -mt-[6px] -ml-[6px] size-[11px] rounded-[2px] border-2 border-gain bg-surface'
                  : m.kind === 'sell'
                    ? 'pointer-events-none absolute -mt-[6px] -ml-[6px] size-3 rounded-full border-2 border-surface bg-loss'
                    : 'pointer-events-none absolute -mt-[6px] -ml-[6px] size-3 rounded-full border-2 border-surface bg-text'
              }
              style={{ left: `${(geo.x(m.i) / W) * 100}%`, top: `${(geo.y(shown[m.i]!.price) / H) * 230}px` }}
            />
          ))}
          {point && hover !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 flex flex-col gap-0.5 rounded-control border border-border bg-surface-2 px-3 py-2 text-small whitespace-nowrap"
              style={
                hover > shown.length / 2
                  ? { right: `${100 - (geo.x(hover) / W) * 100 + 2}%` }
                  : { left: `${(geo.x(hover) / W) * 100 + 2}%` }
              }
            >
              <span className="text-muted">{day(point.date)}</span>
              <span className="num">{formatTradeAmount(point.price.toString())}</span>
            </div>
          ) : null}
          <div className="relative mt-2 h-4 text-small text-muted" aria-hidden="true">
            {ticks.map((i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
                style={{ left: `${(geo.x(i) / W) * 100}%` }}
              >
                {day(shown[i]!.date)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
