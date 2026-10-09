'use client';

import { useMemo, useRef, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { formatDate as formatDay, formatPercent } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';

export interface ReturnsPoint {
  /** «YYYY-MM-DD» */
  date: string;
  /** Cumulative TWR growth of the portfolio (plot coordinates only). */
  growth: number;
  /** Benchmark close, null before its history starts. */
  bench: number | null;
}

const PERIODS = ['1m', '6m', '1y', 'all'] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_DAYS: Record<Period, number | null> = { '1m': 31, '6m': 183, '1y': 366, all: null };
const W = 800;
const H = 220;
const PAD = 12;

function since(points: ReturnsPoint[], period: Period): ReturnsPoint[] {
  const days = PERIOD_DAYS[period];
  if (!days || points.length === 0) return points;
  const last = Date.parse(`${points.at(-1)!.date}T00:00:00Z`);
  const from = new Date(last - days * 86_400_000).toISOString().slice(0, 10);
  return points.filter((p) => p.date >= from);
}

/**
 * Portfolio against its benchmark (Portfolio mockup): both lines in percent from the start of the
 * chosen period, the portfolio by TWR, the index by its close.
 */
export function ReturnsChart({
  points,
  name,
  benchName,
  label,
}: {
  points: ReturnsPoint[];
  name: string;
  benchName: string;
  label: string;
}) {
  const [period, setPeriod] = useState<Period>('1y');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const shown = useMemo(() => since(points, period), [points, period]);

  const lines = useMemo(() => {
    const g0 = shown[0]?.growth ?? 1;
    const b0 = shown.find((p) => p.bench !== null)?.bench ?? null;
    const rows = shown.map((p) => ({
      date: p.date,
      p: (p.growth / g0 - 1) * 100,
      b: b0 && p.bench !== null ? (p.bench / b0 - 1) * 100 : null,
    }));
    const values = rows.flatMap((r) => (r.b === null ? [r.p] : [r.p, r.b]));
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const x = (i: number) => (rows.length <= 1 ? W / 2 : (i / (rows.length - 1)) * W);
    const y = (v: number) => PAD + (1 - (v - min) / span) * (H - 2 * PAD);
    const path = (pick: (r: (typeof rows)[number]) => number | null) => {
      let d = '';
      let pen = false;
      rows.forEach((r, i) => {
        const v = pick(r);
        if (v === null) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    return { rows, x, y, zero: y(0), portfolio: path((r) => r.p), bench: path((r) => r.b) };
  }, [shown]);

  const end = lines.rows.at(-1);
  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? ru.common.none : formatPercent(v.toFixed(1), { signed: true });
  const pick = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || lines.rows.length === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (lines.rows.length - 1)));
  };
  const point = hover !== null ? lines.rows[hover] : null;
  const tickCount = Math.min(6, lines.rows.length);
  const ticks =
    lines.rows.length < 2
      ? []
      : Array.from({ length: tickCount }, (_, k) =>
          Math.round((k * (lines.rows.length - 1)) / (tickCount - 1)),
        );
  const day = (date: string) => formatDay(new Date(`${date}T12:00:00Z`), 'UTC');

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-5 text-caption text-muted" data-testid="returns-legend">
          <div className="flex items-center gap-2">
            <span className="h-[3px] w-[18px] rounded-sm bg-accent" />
            <span>
              {name}, {pct(end?.p)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0 w-[18px] border-t-2 border-dashed border-muted" />
            <span>
              {benchName}, {pct(end?.b)}
            </span>
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
      {lines.rows.length < 2 ? (
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
              if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? lines.rows.length) - 1));
              if (e.key === 'ArrowRight') setHover((h) => Math.min(lines.rows.length - 1, (h ?? -1) + 1));
              if (e.key === 'Escape') setHover(null);
            }}
            onBlur={() => setHover(null)}
          >
            <path
              d={`M0 ${lines.zero}H${W}`}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <path
              d={lines.bench}
              fill="none"
              className="stroke-muted"
              strokeWidth={2}
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={lines.portfolio}
              fill="none"
              className="stroke-accent"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            {point && hover !== null ? (
              <path
                d={`M${lines.x(hover)} 0V${H}`}
                className="stroke-border-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {point && hover !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 flex flex-col gap-0.5 rounded-control border border-border bg-surface-2 px-3 py-2 text-small whitespace-nowrap"
              style={
                hover > lines.rows.length / 2
                  ? { right: `${100 - (lines.x(hover) / W) * 100 + 2}%` }
                  : { left: `${(lines.x(hover) / W) * 100 + 2}%` }
              }
            >
              <span className="text-muted">{day(point.date)}</span>
              <span className="num">
                {name}: {pct(point.p)}
              </span>
              <span className="num text-muted">
                {benchName}: {pct(point.b)}
              </span>
            </div>
          ) : null}
          <div className="relative mt-2 h-4 text-small text-muted" aria-hidden="true">
            {ticks.map((i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
                style={{ left: `${(lines.x(i) / W) * 100}%` }}
              >
                {day(lines.rows[i]!.date)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
