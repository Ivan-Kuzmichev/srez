import type { Metadata } from 'next';
import { PageStub } from '@/components/shell/stub';
import { ru } from '@/lib/i18n/ru';

export const metadata: Metadata = { title: ru.pages.operationNew };

export default function Page() {
  return <PageStub title={ru.pages.operationNew} phase={2} />;
}
