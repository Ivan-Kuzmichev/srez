'use client';

import { useMemo, useRef, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Decimal } from '@/domain/decimal';
import { drawdownSeries } from '@/domain/risk';
import { formatDate as formatDay, formatMonthAxis, formatPercent } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';

const PERIODS = ['1y', '3y', 'all'] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_DAYS: Record<Period, number | null> = { '1y': 366, '3y': 1096, all: null };
const W = 800;
const H = 180;
const PAD = 6;

/**
 * «Просадка от максимума» (Risk mockup): the fall from the running peak within the chosen period,
 * filled down from 0 %, the bottom labelled.
 */
export function DrawdownChart({ points }: { points: { date: string; index: string }[] }) {
  const [period, setPeriod] = useState<Period>('1y');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const rows = useMemo(() => {
    const days = PERIOD_DAYS[period];
    let shown = points;
    if (days && points.length > 0) {
      const last = Date.parse(`${points.at(-1)!.date}T00:00:00Z`);
      const from = new Date(last - days * 86_400_000).toISOString().slice(0, 10);
      shown = points.filter((p) => p.date >= from);
    }
    return drawdownSeries(shown.map((p) => ({ date: p.date, index: new Decimal(p.index) }))).map((p) => ({
      date: p.date,
      dd: p.dd.times(100).toNumber(),
    }));
  }, [points, period]);

  const geo = useMemo(() => {
    const min = Math.min(...rows.map((r) => r.dd), -1);
    const x = (i: number) => (rows.length <= 1 ? W / 2 : (i / (rows.length - 1)) * W);
    const y = (v: number) => PAD + (v / min) * (H - 2 * PAD);
    let line = '';
    rows.forEach((r, i) => (line += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r.dd).toFixed(1)}`));
    const bottom = rows.reduce((b, r, i) => (r.dd < rows[b]!.dd ? i : b), 0);
    return { x, y, line, area: rows.length ? `${line}L${W} ${PAD}L0 ${PAD}Z` : '', bottom };
  }, [rows]);

  const day = (date: string) => formatDay(new Date(`${date}T12:00:00Z`), 'UTC');
  const pct = (v: number) => formatPercent(v.toFixed(1));
  const low = rows[geo.bottom];
  const point = hover !== null ? rows[hover] : null;
  const pick = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rows.length === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (rows.length - 1)));
  };
  // Month ticks: the first day of a month, at most six of them.
  const months = rows.flatMap((r, i) =>
    i > 0 && r.date.slice(0, 7) !== rows[i - 1]!.date.slice(0, 7) ? [i] : [],
  );
  const step = Math.max(1, Math.ceil(months.length / 6));
  const ticks = months.filter((_, k) => k % step === 0);

  return (
    <section
      className="flex flex-col gap-3.5 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="drawdown"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{ru.risk.drawdownTitle}</h2>
        <div className="max-wide:hidden">
          <Segmented
            aria-label={ru.chart.period}
            value={period}
            onValueChange={(p) => {
              setPeriod(p as Period);
              setHover(null);
            }}
            options={PERIODS.map((p) => ({ value: p, label: ru.risk.periods[p]! }))}
          />
        </div>
      </div>
      {rows.length < 2 ? (
        <div className="flex h-[200px] items-center justify-center rounded-control bg-surface-2 text-caption text-muted">
          {ru.chart.empty}
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={ru.risk.drawdownLabel}
            tabIndex={0}
            className="block h-[200px] w-full cursor-crosshair touch-none"
            onPointerMove={(e) => pick(e.clientX)}
            onPointerLeave={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? rows.length) - 1));
              if (e.key === 'ArrowRight') setHover((h) => Math.min(rows.length - 1, (h ?? -1) + 1));
              if (e.key === 'Escape') setHover(null);
            }}
            onBlur={() => setHover(null)}
          >
            <path
              d={`M0 ${PAD}H${W}`}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <path d={geo.area} className="fill-loss-bg" />
            <path
              d={geo.line}
              fill="none"
              className="stroke-loss"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
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
          <span className="num absolute top-0.5 left-0 text-small text-muted">0 %</span>
          {low && low.dd < 0 ? (
            <span
              className="num absolute top-[164px] text-small whitespace-nowrap text-loss"
              style={
                geo.bottom > rows.length / 2
                  ? { right: `${100 - (geo.x(geo.bottom) / W) * 100}%` }
                  : { left: `${(geo.x(geo.bottom) / W) * 100}%` }
              }
            >
              {ru.risk.bottom(pct(low.dd), day(low.date))}
            </span>
          ) : null}
          {point && hover !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 flex flex-col gap-0.5 rounded-control border border-border bg-surface-2 px-3 py-2 text-small whitespace-nowrap"
              style={
                hover > rows.length / 2
                  ? { right: `${100 - (geo.x(hover) / W) * 100 + 2}%` }
                  : { left: `${(geo.x(hover) / W) * 100 + 2}%` }
              }
            >
              <span className="text-muted">{day(point.date)}</span>
              <span className="num">{pct(point.dd)}</span>
            </div>
          ) : null}
          <div className="relative mt-2 h-4 text-small text-muted" aria-hidden="true">
            {ticks.map((i) => (
              <span
                key={i}
                className="num absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${(geo.x(i) / W) * 100}%` }}
              >
                {formatMonthAxis(rows[i]!.date)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
