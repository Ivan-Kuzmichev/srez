import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ru } from '@/lib/i18n/ru';

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 p-4 wide:p-8">
      <Logo />
      <EmptyState
        figure="404"
        title={ru.errors.notFoundTitle}
        description={ru.errors.notFoundDescription}
        actions={
          <div>
            <Button variant="primary" asChild>
              <Link href="/">{ru.errors.toOverview}</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
