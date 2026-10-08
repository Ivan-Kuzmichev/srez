import { PageHeader } from '@/components/shell/page-header';
import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { ru } from '@/lib/i18n/ru';

export default function Loading() {
  return (
    <>
      <PageHeader title={ru.pages.operations} />
      <Skeleton className="h-11 w-full" />
      <CardSkeleton rows={8} />
    </>
  );
}
