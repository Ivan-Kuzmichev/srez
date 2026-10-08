import { EmptyState } from '@/components/ui/empty-state';
import { ru } from '@/lib/i18n/ru';
import { PageHeader } from './page-header';

/** Placeholder for a route whose screen comes in a later phase. */
export function PageStub({ title, phase }: { title: string; phase: number }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={ru.stub.title} description={ru.stub.description(phase)} />
    </>
  );
}
