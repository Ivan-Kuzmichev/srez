'use client';

import { useRouter } from 'next/navigation';
import { usePasskeySupport } from '@/components/auth/use-passkey';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { authClient } from '@/lib/auth-client';
import { ru } from '@/lib/i18n/ru';
import { deletePasskey, passkeyAdded } from '@/server/actions/passkeys';

export interface PasskeyItem {
  id: string;
  name: string | null;
  /** Pre-formatted on the server: «14 сен», «сегодня». */
  added: string;
  lastUsed: string | null;
}

export function PasskeysCard({ passkeys, defaultName }: { passkeys: PasskeyItem[]; defaultName: string }) {
  const router = useRouter();
  const notify = useToast();
  const supported = usePasskeySupport();

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{ru.security.passkeysTitle}</h2>
        {supported ? (
          <FormDialog
            trigger={<Button variant="secondary-raised">{ru.security.addPasskey}</Button>}
            title={ru.security.addPasskeyTitle}
            description={ru.security.addPasskeyText}
            submitLabel={ru.security.addPasskey}
            onSubmit={async (form) => {
              const name = String(form.get('name') ?? '').trim() || defaultName;
              const result = await authClient.passkey.addPasskey({ name });
              if (result?.error) return ru.security.passkeyAddFailed;
              await passkeyAdded(null, { name });
              notify({ tone: 'success', title: ru.security.passkeyAdded });
              router.refresh();
              return null;
            }}
          >
            <Field label={ru.security.passkeyName}>
              {(f) => <Input id={f.id} name="name" defaultValue={defaultName} maxLength={64} />}
            </Field>
          </FormDialog>
        ) : null}
      </div>
      {!supported ? (
        <div className="text-pretty text-caption text-muted">{ru.security.passkeysUnavailable}</div>
      ) : null}
      {passkeys.length === 0 ? (
        supported ? (
          <div className="text-caption text-muted">{ru.security.passkeysEmpty}</div>
        ) : null
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-testid="passkeys">
          {passkeys.map((p) => {
            const name = p.name || ru.security.passkeyUnnamed;
            return (
              <li
                key={p.id}
                className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{name}</span>
                  <span className="text-small text-muted">
                    {ru.security.passkeyMeta(p.added, p.lastUsed)}
                  </span>
                </span>
                <ConfirmDialog
                  trigger={<Button variant="danger-text">{ru.security.deletePasskey}</Button>}
                  title={ru.security.deletePasskeyTitle(name)}
                  description={ru.security.deletePasskeyText}
                  confirmLabel={ru.security.deletePasskey}
                  danger
                  onConfirm={async () => {
                    const result = await deletePasskey(null, { id: p.id });
                    notify(
                      result.ok
                        ? { tone: 'success', title: ru.security.passkeyDeleted }
                        : { tone: 'error', title: ru.security.failedToast },
                    );
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
