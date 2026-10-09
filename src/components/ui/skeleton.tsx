import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

/** Loading placeholder block. Size it with width and height classes. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn('animate-pulse rounded-control bg-track', className)}
    />
  );
}

/** Placeholder for a whole card while its data loads. */
export function CardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label={ru.common.loading}
      className={cn(
        'flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6',
        className,
      )}
    >
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

/** Placeholder for a row of metric cards («Стоимость», «Прибыль», …). */
export function MetricsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label={ru.common.loading}
      className="grid grid-cols-2 gap-3 wide:grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] wide:gap-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 rounded-card border border-border bg-surface px-4 py-4 wide:px-6 wide:py-5"
        >
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-40 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a chart card. */
export function ChartSkeleton({ height = 230 }: { height?: number }) {
  return (
    <div
      role="status"
      aria-label={ru.common.loading}
      className="flex flex-col gap-3.5 rounded-card border border-border bg-surface p-4 wide:p-6"
    >
      <Skeleton className="h-5 w-48" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}
