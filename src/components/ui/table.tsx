import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Wide tables scroll inside their container; the page never scrolls sideways. */
export function Table({
  minWidth = 720,
  className,
  ...props
}: HTMLAttributes<HTMLTableElement> & { minWidth?: number }) {
  return (
    // Focusable, so a keyboard can scroll a table wider than the screen (WCAG 2.1.1).
    // `relative`: hidden headings (sr-only, absolutely placed) stay inside the scroller, not past the page.
    <div className="relative overflow-x-auto" tabIndex={0}>
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
  pad = 'normal',
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: Align;
  mono?: boolean;
  /** «tall» matches roomy lists (14 px), «none» is for a cell holding a 44 px button. */
  pad?: 'normal' | 'tall' | 'none';
}) {
  return (
    <td
      className={cn(
        'border-b border-border-subtle px-3 whitespace-nowrap first:pl-0 last:pr-0',
        pad === 'normal' ? 'py-3' : pad === 'tall' ? 'py-3.5' : 'py-0',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'num',
        className,
      )}
      {...props}
    />
  );
}
