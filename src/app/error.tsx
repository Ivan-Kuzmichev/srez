'use client';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ru } from '@/lib/i18n/ru';

/** Server details stay in the log; the page shows only the digest to match it. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-4 p-4 wide:p-8">
      <EmptyState
        title={ru.errors.errorTitle}
        description={
          <>
            {ru.errors.errorDescription}
            {error.digest ? (
              <span className="mt-2 block text-small">
                {ru.errors.errorId}: <span className="num">{error.digest}</span>
              </span>
            ) : null}
          </>
        }
        actions={
          <div>
            <Button variant="primary" onClick={reset}>
              {ru.common.retry}
            </Button>
          </div>
        }
      />
    </main>
  );
}
