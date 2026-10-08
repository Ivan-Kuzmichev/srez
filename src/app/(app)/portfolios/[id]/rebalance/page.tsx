import type { Metadata } from 'next';
import { PageStub } from '@/components/shell/stub';
import { ru } from '@/lib/i18n/ru';

export const metadata: Metadata = { title: ru.pages.rebalance };

export default function Page() {
  return <PageStub title={ru.pages.rebalance} phase={6} />;
}
