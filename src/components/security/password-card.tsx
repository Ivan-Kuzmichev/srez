'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { changePassword } from '@/server/actions/security';

export function PasswordCard({
  login,
  changed,
  minLength,
}: {
  login: string;
  changed: string | null;
  minLength: number;
}) {
  const router = useRouter();
  const notify = useToast();

  const dialog = (trigger: React.ReactNode) => (
    <FormDialog
      trigger={trigger}
      title={ru.security.changePassword}
      description={ru.security.changePasswordText}
      submitLabel={ru.security.changePassword}
      onSubmit={async (form) => {
        const result = await changePassword(null, form);
        if (!result.ok) {
          const fields = result.fieldErrors ?? {};
          if (fields.repeatPassword) return ru.security.passwordsDiffer;
          if (fields.newPassword) return ru.security.passwordShort(minLength);
          return ru.security.wrongCurrentPassword;
        }
        notify({ tone: 'success', title: ru.security.passwordChanged });
        router.refresh();
        return null;
      }}
    >
      <Field label={ru.security.currentPassword}>
        {(f) => (
          <Input id={f.id} name="currentPassword" type="password" autoComplete="current-password" required />
        )}
      </Field>
      <Field label={ru.security.newPassword}>
        {(f) => (
          <Input
            id={f.id}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={minLength}
            required
          />
        )}
      </Field>
      <Field label={ru.security.repeatPassword}>
        {(f) => (
          <Input
            id={f.id}
            name="repeatPassword"
            type="password"
            autoComplete="new-password"
            minLength={minLength}
            required
          />
        )}
      </Field>
    </FormDialog>
  );

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 wide:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-card font-semibold">{ru.security.passwordTitle}</h2>
        <span className="hidden text-caption text-muted wide:inline">
          {ru.security.passwordMeta(login, changed)}
        </span>
        {changed ? (
          <span className="text-small text-muted wide:hidden">{ru.security.passwordMetaPhone(changed)}</span>
        ) : null}
      </div>
      <div className="hidden wide:block">
        {dialog(<Button variant="secondary-raised">{ru.security.changePassword}</Button>)}
      </div>
      <div className="wide:hidden">
        {dialog(<Button variant="secondary-raised">{ru.security.changePasswordShort}</Button>)}
      </div>
    </section>
  );
}
