'use client';

import { AlertDialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { ru } from '@/lib/i18n/ru';
import { Button } from './button';

export interface ConfirmDialogProps {
  /** The element that opens the dialog, usually a Button; omit when controlled with `open`. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  /** Destructive actions get the danger style. */
  danger?: boolean;
  /** May be async; the dialog stays open and disabled until it settles. */
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
}: ConfirmDialogProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-bg-nav/80" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-border bg-surface p-6">
          <AlertDialog.Title className="m-0 text-card font-semibold">{title}</AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="m-0 text-row text-text-2">
              {description}
            </AlertDialog.Description>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary-raised" disabled={busy}>
                {ru.common.cancel}
              </Button>
            </AlertDialog.Cancel>
            <Button variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={() => void confirm()}>
              {confirmLabel ?? ru.common.confirm}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
