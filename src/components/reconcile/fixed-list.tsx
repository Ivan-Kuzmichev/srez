'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { undoReconcileFix } from '@/server/actions/reconcile';

/** Recent fixes with «Отменить» (FR-REC-4): the operation goes, the discrepancy opens again. */
export function FixedList({ items }: { items: { id: number; title: string; detail: string }[] }) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  if (items.length === 0) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-card border border-border bg-surface px-4 py-3 wide:px-[18px]"
      data-testid="reconcile-fixed"
    >
      <h2 className="m-0 text-caption font-medium text-muted">{ru.reconcile.fixedTitle}</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((f) => (
          <li
            key={f.id}
            className="flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{f.title}</span>
              <span className="text-small text-muted">{f.detail}</span>
            </span>
            <Button
              variant="text"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await undoReconcileFix(null, { discrepancyId: f.id });
                  notify(
                    r.ok
                      ? { tone: 'success', title: ru.reconcile.undone }
                      : { tone: 'error', title: ru.reconcile.failed },
                  );
                  router.refresh();
                })
              }
            >
              {ru.reconcile.undo}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
