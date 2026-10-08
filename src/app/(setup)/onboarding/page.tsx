import type { Metadata } from 'next';
import { Logo } from '@/components/logo';
import { PageStub } from '@/components/shell/stub';
import { ru } from '@/lib/i18n/ru';

export const metadata: Metadata = { title: ru.pages.onboarding };

export default function Page() {
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 p-4 wide:p-8">
      <Logo />
      <PageStub title={ru.pages.onboarding} phase={4} />
    </main>
  );
}
