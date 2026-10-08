import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Wide tables scroll inside their container; the page never scrolls sideways. */
export function Table({
  minWidth = 720,
  className,
  ...props
}: HTMLAttributes<HTMLTableElement> & { minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table style={{ minWidth }} className={cn('w-full border-collapse text-row', className)} {...props} />
    </div>
  );
}

type Align = 'left' | 'right';

export function Th({
  align = 'left',
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border px-3 py-2.5 text-small font-medium text-muted first:pl-0 last:pr-0',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  align = 'left',
  mono,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; mono?: boolean }) {
  return (
    <td
      className={cn(
        'border-b border-border-subtle px-3 py-3 whitespace-nowrap first:pl-0 last:pr-0',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'num',
        className,
      )}
      {...props}
    />
  );
}
