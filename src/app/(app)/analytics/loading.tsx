import { PageHeader } from '@/components/shell/page-header';
import { CardSkeleton, ChartSkeleton, MetricsSkeleton } from '@/components/ui/skeleton';
import { ru } from '@/lib/i18n/ru';

export default function Loading() {
  return (
    <>
      <PageHeader title={ru.pages.analytics} />
      <MetricsSkeleton />
      <ChartSkeleton height={200} />
      <CardSkeleton rows={6} />
    </>
  );
}
