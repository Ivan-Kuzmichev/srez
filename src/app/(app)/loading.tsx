import { CardSkeleton, ChartSkeleton, MetricsSkeleton, Skeleton } from '@/components/ui/skeleton';

/** Any screen without its own placeholder: a title, metrics, a chart and a card (docs/08-ui.md, section 5). */
export default function Loading() {
  return (
    <>
      <Skeleton className="h-9 w-56" />
      <MetricsSkeleton />
      <ChartSkeleton />
      <CardSkeleton rows={6} />
    </>
  );
}
