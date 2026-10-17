import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TargetBarProps {
  label: ReactNode;
  /** «38,4 / 40 %», formatted by the caller. */
  valueLabel: ReactNode;
  /** Actual and target shares in percent; `scaleMax` is the share at full bar width. No target, no marker. */
  actual: number;
  target: number | null;
  scaleMax: number;
  /** Outside the allowed deviation: the value turns loss-colored. */
  offTarget?: boolean;
  /** A row without a known category (a sector the broker does not give): muted. */
  muted?: boolean;
  /**
   * A tooltip on hover, focus or tap: how far from the target and what reaches it («Докупить ≈ 165 000 ₽»).
   * The row becomes focusable so the keyboard and a touch screen reach it too.
   */
  hint?: { title: string; action: string } | null;
}

const pct = (value: number, max: number) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;

/** Fact against target with a marker, as in «Цели и ребаланс». */
export function TargetBar({
  label,
  valueLabel,
  actual,
  target,
  scaleMax,
  offTarget,
  muted,
  hint,
}: TargetBarProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-[7px] rounded-nav text-row outline-offset-4',
        hint && 'cursor-default',
      )}
      tabIndex={hint ? 0 : undefined}
      aria-label={hint ? `${String(label)}: ${hint.title}. ${hint.action}` : undefined}
    >
      {hint ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden flex-col gap-0.5 rounded-control border border-border bg-surface-2 px-3 py-2 text-small whitespace-nowrap group-hover:flex group-focus:flex"
        >
          <span className="text-muted">{hint.title}</span>
          <span className="num text-caption text-text">{hint.action}</span>
        </div>
      ) : null}
      <div className="flex justify-between gap-3">
        <span className={cn(muted && 'text-muted')}>{label}</span>
        <span
          className={cn(
            'num text-caption whitespace-nowrap',
            offTarget && 'text-loss',
            muted && 'text-muted',
          )}
        >
          {valueLabel}
        </span>
      </div>
      <div className="relative h-2 rounded-bar bg-track">
        <div
          className={cn('h-full rounded-bar', muted ? 'bg-border-strong' : 'bg-accent')}
          style={{ width: pct(actual, scaleMax) }}
        />
        {target !== null ? (
          <div
            aria-hidden="true"
            className="absolute -top-1 h-4 w-0.5 bg-text"
            style={{ left: pct(target, scaleMax) }}
          />
        ) : null}
      </div>
    </div>
  );
}
