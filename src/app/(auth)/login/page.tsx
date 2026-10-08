import type { Metadata } from 'next';
import { Card } from '@/components/ui/card';
import { ru } from '@/lib/i18n/ru';

export const metadata: Metadata = { title: ru.pages.login };

export default function Page() {
  return (
    <Card>
      <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em]">{ru.pages.login}</h1>
      <p className="m-0 text-muted">{ru.stub.description(1)}</p>
    </Card>
  );
}
