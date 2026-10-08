import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const ASSET_CLASS_COLOR = {
  stocks: 'bg-class-stocks',
  bonds: 'bg-class-bonds',
  funds: 'bg-class-funds',
  crypto: 'bg-class-crypto',
  cash: 'bg-class-cash',
  // Not in the mockups; a neutral fill until the owner picks one.
  other: 'bg-border-strong',
} as const;

export type AssetClassKey = keyof typeof ASSET_CLASS_COLOR;

export interface AllocationSegment {
  key: string;
  label: ReactNode;
  /** Share in percent, used for the bar width only. */
  share: number;
  colorClass: string;
  /** Pre-formatted amount and share for the legend. */
  amount?: ReactNode;
  shareLabel: ReactNode;
}

/** Stacked structure bar with a legend underneath. */
export function AllocationBar({
  segments,
  'aria-label': ariaLabel,
}: {
  segments: readonly AllocationSegment[];
  'aria-label': string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div role="img" aria-label={ariaLabel} className="flex h-3.5 gap-[3px]">
        {segments
          .filter((s) => s.share > 0)
          .map((s) => (
            <div
              key={s.key}
              className={cn('rounded-mark', s.colorClass)}
              style={{ flex: `${s.share} 1 0` }}
            />
          ))}
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 text-row">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-mark', s.colorClass)} />
            <span className="flex-1">{s.label}</span>
            {s.amount !== undefined ? (
              <span className="num whitespace-nowrap text-muted">{s.amount}</span>
            ) : null}
            <span className="num w-14 text-right">{s.shareLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
