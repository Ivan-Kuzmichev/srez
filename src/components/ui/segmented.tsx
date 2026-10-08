'use client';

import { ToggleGroup } from 'radix-ui';
import { cn } from '@/lib/cn';

export interface SegmentedOption {
  value: string;
  label: string;
  /** Accessible name when the label is a symbol, e.g. «₽». */
  ariaLabel?: string;
}

export interface SegmentedProps {
  options: readonly SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  'aria-label': string;
  /** Currency symbols and periods use monospace in the mockups. */
  mono?: boolean;
  className?: string;
}

/** Single-choice switch: periods on charts, display currency. */
export function Segmented({ options, value, onValueChange, mono, className, ...aria }: SegmentedProps) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix sends '' when the active item is clicked again; a segmented switch always keeps one.
      onValueChange={(next) => next && onValueChange(next)}
      className={cn('inline-flex overflow-hidden rounded-control border border-border', className)}
      {...aria}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={o.ariaLabel}
          className={cn(
            'min-h-11 min-w-12 cursor-pointer border-0 bg-surface px-2 text-caption text-muted',
            'data-[state=on]:bg-pressed data-[state=on]:text-text',
            mono && 'num min-w-11 text-row',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
