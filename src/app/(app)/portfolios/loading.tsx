import { PageHeader } from '@/components/shell/page-header';
import { CardSkeleton, MetricsSkeleton } from '@/components/ui/skeleton';
import { ru } from '@/lib/i18n/ru';

export default function Loading() {
  return (
    <>
      <PageHeader title={ru.pages.portfolios} />
      <MetricsSkeleton count={3} />
      <CardSkeleton rows={6} />
    </>
  );
}
