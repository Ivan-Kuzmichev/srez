import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type PillTone = 'accent' | 'gain' | 'loss' | 'neutral' | 'warn';

const tones: Record<PillTone, string> = {
  accent: 'bg-accent-bg text-accent-text',
  gain: 'bg-gain-bg text-gain',
  loss: 'bg-loss-bg text-loss',
  neutral: 'bg-track text-text-2',
  warn: 'bg-warn-bg text-warn',
};

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

/** Status label: «Синхронизирован», «Ошибка», tag names. */
export function Pill({ tone = 'neutral', className, ...props }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-small whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Log level tag: square-ish, as in the Logs mockup. */
export function LevelTag({ tone = 'neutral', className, ...props }: PillProps) {
  return <span className={cn('num rounded-tag px-2 py-0.5 text-small', tones[tone], className)} {...props} />;
}
