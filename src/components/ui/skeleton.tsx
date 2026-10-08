import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

/** Loading placeholder block. Size it with width and height classes. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-control bg-track', className)} />;
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
