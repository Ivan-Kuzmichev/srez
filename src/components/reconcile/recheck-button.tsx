'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { recheckSource } from '@/server/actions/reconcile';

export function RecheckButton({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      className="max-wide:hidden"
      onClick={() =>
        start(async () => {
          const r = await recheckSource(null, { sourceId });
          notify(
            r.ok
              ? { tone: 'success', title: ru.reconcile.recheckQueued }
              : { tone: 'error', title: ru.reconcile.failed },
          );
          router.refresh();
        })
      }
    >
      {ru.reconcile.recheck}
    </Button>
  );
}
