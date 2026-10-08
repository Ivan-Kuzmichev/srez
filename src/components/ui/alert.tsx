import type { ReactNode } from 'react';
import { IconAlert } from '@/components/icons';
import { cn } from '@/lib/cn';

/** Inline error or warning block (LoginError mockup). */
export function Alert({
  children,
  tone = 'error',
  className,
}: {
  children: ReactNode;
  tone?: 'error' | 'warn';
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-control border px-3.5 py-3 text-row',
        tone === 'error'
          ? 'border-loss-border bg-loss-bg text-loss-text'
          : 'border-border bg-warn-bg text-warn',
        className,
      )}
    >
      <span className="flex pt-0.5">
        <IconAlert />
      </span>
      <span className="text-pretty">{children}</span>
    </div>
  );
}
