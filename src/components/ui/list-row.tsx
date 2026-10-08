import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right side: amount, change, status. */
  value?: ReactNode;
  valueHint?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

/** A row in a card list: title and subtitle on the left, value on the right, divider below. */
export function ListRow({ title, subtitle, value, valueHint, leading, className }: ListRowProps) {
  return (
    <div
      className={cn(
        'flex min-h-11 items-center gap-3 border-b border-border-subtle py-3 last:border-b-0',
        className,
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-row">{title}</div>
        {subtitle ? <div className="truncate text-small text-muted">{subtitle}</div> : null}
      </div>
      {value !== undefined ? (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <div className="num text-row whitespace-nowrap">{value}</div>
          {valueHint ? <div className="num text-small whitespace-nowrap text-muted">{valueHint}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
