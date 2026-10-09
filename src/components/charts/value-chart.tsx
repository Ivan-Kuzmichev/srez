'use client';

import { useMemo, useRef, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Money } from '@/domain/money';
import { formatDate as formatDay, formatMoney } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';

export interface ChartPoint {
  /** «YYYY-MM-DD» */
  date: string;
  /** Plot values only: money is formatted by the caller through `format`. */
  value: number;
  invested: number;
}

const PERIODS = ['1m', '6m', '1y', 'all'] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_DAYS: Record<Period, number | null> = { '1m': 31, '6m': 183, '1y': 366, all: null };

const W = 800;
const H = 220;
const PAD_TOP = 12;
const PAD_BOTTOM = 8;

function since(points: ChartPoint[], period: Period): ChartPoint[] {
  const days = PERIOD_DAYS[period];
  if (!days || points.length === 0) return points;
  const last = new Date(`${points[points.length - 1]!.date}T00:00:00Z`);
  const from = new Date(last.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return points.filter((p) => p.date >= from);
}

/**
 * Value against invested (Main, Portfolio mockups): a filled line for the value, a dashed one for
 * what went in, a period switch and a tooltip with the date and both values.
 */
export function ValueChart({
  points,
  currency,
  label,
}: {
  points: ChartPoint[];
  currency: string;
  label: string;
}) {
  const format = (v: number) => formatMoney(Money.of(v.toFixed(currency === 'BTC' ? 8 : 2), currency));
  const formatDate = (date: string) => formatDay(new Date(`${date}T12:00:00Z`), 'UTC');
  const [period, setPeriod] = useState<Period>('1y');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const shown = useMemo(() => since(points, period), [points, period]);

  const { valuePath, areaPath, investedPath, x, y } = useMemo(() => {
    const values = shown.flatMap((p) => [p.value, p.invested]);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const x = (i: number) => (shown.length <= 1 ? W / 2 : (i / (shown.length - 1)) * W);
    const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);
    const line = (key: 'value' | 'invested') =>
      shown.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');
    const valuePath = line('value');
    const areaPath = shown.length
      ? `${valuePath}L${x(shown.length - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z`
      : '';
    return { valuePath, areaPath, investedPath: line('invested'), x, y };
  }, [shown]);

  const ticks = useMemo(() => {
    if (shown.length < 2) return [];
    const count = Math.min(6, shown.length);
    return Array.from({ length: count }, (_, k) => Math.round((k * (shown.length - 1)) / (count - 1)));
  }, [shown]);

  const pick = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || shown.length === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (shown.length - 1)));
  };
  const point = hover !== null ? shown[hover] : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-5 text-caption text-muted">
          <div className="flex items-center gap-2">
            <span className="h-[3px] w-[18px] rounded-sm bg-accent" />
            <span>{ru.chart.value}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0 w-[18px] border-t-2 border-dashed border-muted" />
            <span>{ru.chart.invested}</span>
          </div>
        </div>
        <Segmented
          aria-label={ru.chart.period}
          value={period}
          onValueChange={(p) => {
            setPeriod(p as Period);
            setHover(null);
          }}
          options={PERIODS.map((p) => ({ value: p, label: ru.chart.periods[p]! }))}
        />
      </div>

      {shown.length === 0 ? (
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
            <path
              d={`M0 ${PAD_TOP}H${W}M0 ${H / 2}H${W}M0 ${H - PAD_BOTTOM}H${W}`}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <path d={areaPath} className="fill-accent opacity-[0.12]" />
            <path
              d={investedPath}
              fill="none"
              className="stroke-muted"
              strokeWidth={2}
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={valuePath}
              fill="none"
              className="stroke-accent"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            {point && hover !== null ? (
              <>
                <path
                  d={`M${x(hover)} 0V${H}`}
                  className="stroke-border-strong"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ) : null}
          </svg>
          {point && hover !== null ? (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
                style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(point.value) / H) * 230}px` }}
              />
              <div
                role="status"
                className="pointer-events-none absolute top-1 z-10 flex flex-col gap-0.5 rounded-control border border-border bg-surface-2 px-3 py-2 text-small whitespace-nowrap"
                style={
                  hover > shown.length / 2
                    ? { right: `${100 - (x(hover) / W) * 100 + 2}%` }
                    : { left: `${(x(hover) / W) * 100 + 2}%` }
                }
              >
                <span className="text-muted">{formatDate(point.date)}</span>
                <span className="num">
                  {ru.chart.value}: {format(point.value)}
                </span>
                <span className="num text-muted">
                  {ru.chart.invested}: {format(point.invested)}
                </span>
              </div>
            </>
          ) : null}
          <div className="relative mt-2 h-4 text-small text-muted" aria-hidden="true">
            {ticks.map((i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
                style={{ left: `${(x(i) / W) * 100}%` }}
              >
                {formatDate(shown[i]!.date)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
