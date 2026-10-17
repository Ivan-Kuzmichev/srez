'use client';

import { useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { IconMore } from '@/components/icons';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { deleteWalletAction, rebuildWallet, renameWalletAction } from '@/server/actions/wallets';

const itemClass =
  'flex min-h-11 cursor-pointer items-center rounded-nav px-3 text-row text-text outline-none select-none data-[highlighted]:bg-pressed hover:text-text';

/** «⋯» on a wallet: rename, rebuild the history, delete. */
export function WalletMenu({ sourceId, name }: { sourceId: string; name: string }) {
  const router = useRouter();
  const notify = useToast();
  const [dialog, setDialog] = useState<'rename' | 'rebuild' | 'delete' | null>(null);
  const t = ru.walletsCard;
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          aria-label={t.actions(name)}
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
            <DropdownMenu.Item className={itemClass} onSelect={() => setDialog('rename')}>
              {t.rename}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={() => setDialog('rebuild')}>
              {t.rebuild}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={`${itemClass} text-loss hover:text-loss`}
              onSelect={() => setDialog('delete')}
            >
              {t.remove}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <FormDialog
        open={dialog === 'rename'}
        onOpenChange={close}
        title={t.renameTitle}
        submitLabel={t.renameSave}
        onSubmit={async (form) => {
          const r = await renameWalletAction(null, { sourceId, name: String(form.get('name') ?? '') });
          if (!r.ok) return t.rebuildFailed;
          notify({ tone: 'success', title: t.renamed });
          router.refresh();
          return null;
        }}
      >
        <Field label={t.renameLabel}>
          {(f) => (
            <Input id={f.id} name="name" defaultValue={name} maxLength={60} required autoComplete="off" />
          )}
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={dialog === 'rebuild'}
        onOpenChange={close}
        title={t.rebuildTitle(name)}
        description={t.rebuildText}
        confirmLabel={t.rebuildConfirm}
        danger
        onConfirm={async () => {
          const r = await rebuildWallet(null, { sourceId });
          notify(
            r.ok ? { tone: 'success', title: t.rebuildQueued } : { tone: 'error', title: t.rebuildFailed },
          );
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        title={t.removeTitle(name)}
        description={t.removeText}
        confirmLabel={t.remove}
        danger
        onConfirm={async () => {
          const r = await deleteWalletAction(null, { sourceId });
          notify(
            r.ok
              ? { tone: 'success', title: r.data.account === 'kept' ? t.removedKept : t.removed }
              : { tone: 'error', title: t.rebuildFailed },
          );
          router.refresh();
        }}
      />
    </>
  );
}
