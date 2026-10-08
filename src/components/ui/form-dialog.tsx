'use client';

import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { ru } from '@/lib/i18n/ru';
import { Alert } from './alert';
import { Button } from './button';

export interface FormDialogProps {
  /** Opens the dialog; omit when the dialog is controlled with `open`. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  submitLabel: string;
  danger?: boolean;
  /** Fields of the form; named inputs end up in the FormData. */
  children: ReactNode;
  /** Returns an error message to show, or null to close. Typed input is kept on error. */
  onSubmit: (form: FormData) => Promise<string | null>;
}

/** Small dialog with a form: confirm with a password, change the password, name a passkey. */
export function FormDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  submitLabel,
  danger,
  children,
  onSubmit,
}: FormDialogProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit(new FormData(event.currentTarget));
      if (message) setError(message);
      else setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-nav/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-card border border-border bg-surface p-6">
          <Dialog.Title className="m-0 text-card font-semibold">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="m-0 text-row text-text-2">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            {error ? <Alert>{error}</Alert> : null}
            {children}
            <div className="flex flex-wrap justify-end gap-3">
              <Dialog.Close asChild>
                <Button variant="secondary-raised" disabled={busy}>
                  {ru.common.cancel}
                </Button>
              </Dialog.Close>
              <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
