import { PageHeader } from '@/components/shell/page-header';
import { CardSkeleton } from '@/components/ui/skeleton';
import { ru } from '@/lib/i18n/ru';

export default function Loading() {
  return (
    <>
      <PageHeader title={ru.pages.sources} />
      <CardSkeleton rows={6} />
      <CardSkeleton rows={4} />
    </>
  );
}
