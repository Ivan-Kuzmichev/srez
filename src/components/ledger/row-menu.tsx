'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { IconMore } from '@/components/icons';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { deleteOperation, setPositionTag } from '@/server/actions/operations';
import { TagSelect, type TagOption } from './tag-select';

const itemClass =
  'flex min-h-11 cursor-pointer items-center rounded-nav px-3 text-row text-text no-underline outline-none select-none data-[highlighted]:bg-pressed hover:text-text';

export interface RowMenuProps {
  id: string;
  manual: boolean;
  accountId: string;
  instrumentId: string | null;
  assetLabel: string;
  tagId: string | null;
  tags: TagOption[];
}

/** «⋯» in a journal row: edit, retag the whole position, delete a manual operation. */
export function RowMenu(props: RowMenuProps) {
  const router = useRouter();
  const notify = useToast();
  const [dialog, setDialog] = useState<'retag' | 'delete' | null>(null);

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          aria-label={ru.journal.rowActions}
          className="flex size-11 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted hover:text-text data-[state=open]:text-text"
        >
          <IconMore size={18} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-40 min-w-56 rounded-control border border-border bg-surface-2 p-1"
          >
            <DropdownMenu.Item asChild className={itemClass}>
              <Link href={`/operations/${props.id}/edit`}>{ru.journal.edit}</Link>
            </DropdownMenu.Item>
            {props.instrumentId ? (
              <DropdownMenu.Item className={itemClass} onSelect={() => setDialog('retag')}>
                {ru.journal.retag}
              </DropdownMenu.Item>
            ) : null}
            {props.manual ? (
              <DropdownMenu.Item
                className={`${itemClass} text-loss hover:text-loss`}
                onSelect={() => setDialog('delete')}
              >
                {ru.journal.delete}
              </DropdownMenu.Item>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {props.instrumentId ? (
        <FormDialog
          open={dialog === 'retag'}
          onOpenChange={(open) => !open && setDialog(null)}
          title={ru.journal.retagTitle(props.assetLabel)}
          description={ru.journal.retagText}
          submitLabel={ru.journal.retagApply}
          onSubmit={async (form) => {
            const result = await setPositionTag(null, {
              accountId: props.accountId,
              instrumentId: props.instrumentId,
              tagId: form.get('tagId'),
            });
            if (!result.ok) return ru.journal.failed;
            notify({ tone: 'success', title: ru.journal.retagDone(result.data.changed) });
            router.refresh();
            return null;
          }}
        >
          <Field label={ru.operation.tag}>
            {(f) => <TagSelect id={f.id} name="tagId" tags={props.tags} defaultValue={props.tagId} />}
          </Field>
        </FormDialog>
      ) : null}

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={ru.journal.deleteTitle}
        description={ru.journal.deleteText}
        confirmLabel={ru.journal.delete}
        danger
        onConfirm={async () => {
          const result = await deleteOperation(null, { id: props.id });
          notify(
            result.ok
              ? { tone: 'success', title: ru.journal.deleted }
              : { tone: 'error', title: ru.journal.failed },
          );
          router.refresh();
        }}
      />
    </>
  );
}
