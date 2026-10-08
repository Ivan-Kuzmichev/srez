import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TargetBarProps {
  label: ReactNode;
  /** «38,4 / 40 %», formatted by the caller. */
  valueLabel: ReactNode;
  /** Actual and target shares in percent; `scaleMax` is the share at full bar width. */
  actual: number;
  target: number;
  scaleMax: number;
  /** Outside the allowed deviation: the value turns loss-colored. */
  offTarget?: boolean;
}

const pct = (value: number, max: number) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;

/** Fact against target with a marker, as in «Цели и ребаланс». */
export function TargetBar({ label, valueLabel, actual, target, scaleMax, offTarget }: TargetBarProps) {
  return (
    <div className="flex flex-col gap-[7px] text-row">
      <div className="flex justify-between gap-3">
        <span>{label}</span>
        <span className={cn('num text-caption whitespace-nowrap', offTarget && 'text-loss')}>
          {valueLabel}
        </span>
      </div>
      <div className="relative h-2 rounded-bar bg-track">
        <div className="h-full rounded-bar bg-accent" style={{ width: pct(actual, scaleMax) }} />
        <div
          aria-hidden="true"
          className="absolute -top-1 h-4 w-0.5 bg-text"
          style={{ left: pct(target, scaleMax) }}
        />
      </div>
    </div>
  );
}
