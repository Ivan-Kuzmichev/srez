import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'default' | 'gain' | 'loss' | 'muted';

export const toneText: Record<Tone, string> = {
  default: 'text-text',
  gain: 'text-gain',
  loss: 'text-loss',
  muted: 'text-muted',
};

export interface MetricProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  /** hero: the big number on top of a page; md: a stat tile; sm: inline stat row. */
  size?: 'hero' | 'md' | 'sm';
  className?: string;
}

const valueSize = {
  hero: 'text-hero-phone wide:text-hero font-medium tracking-[-0.02em]',
  md: 'text-metric-phone wide:text-metric font-medium',
  sm: 'text-body',
};

/** Label, number, explanation. Numbers come pre-formatted from lib/format. */
export function Metric({ label, value, hint, tone = 'default', size = 'md', className }: MetricProps) {
  return (
    <div className={cn('flex flex-col', size === 'hero' ? 'gap-2' : 'gap-1', className)}>
      <div className={cn('text-muted', size === 'hero' ? 'text-caption' : 'text-small')}>{label}</div>
      <div className={cn('num whitespace-nowrap', valueSize[size], toneText[tone])}>{value}</div>
      {hint ? <div className="text-small text-muted">{hint}</div> : null}
    </div>
  );
}
