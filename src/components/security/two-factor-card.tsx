'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { QrCode } from '@/components/qr-code';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import {
  confirmTwoFactor,
  disableTwoFactor,
  regenerateBackupCodes,
  startTwoFactor,
} from '@/server/actions/security';
import { BackupCodes, EnabledPill } from './backup-codes';

export interface TwoFactorCardProps {
  enabled: boolean;
  /** «сегодня» or «5 окт», formatted on the server. */
  enabledOn: string | null;
  backupCodesLeft: number;
  backupCodesTotal: number;
}

type Setup = { totpURI: string; secret: string };

const passwordError = (code: string) =>
  code === 'INVALID_PASSWORD' ? ru.security.wrongPassword : ru.security.failedToast;

function PasswordField() {
  return (
    <Field label={ru.security.passwordLabel}>
      {(f) => <Input id={f.id} name="password" type="password" autoComplete="current-password" required />}
    </Field>
  );
}

export function TwoFactorCard(props: TwoFactorCardProps) {
  const router = useRouter();
  const notify = useToast();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (codes) {
    return (
      <BackupCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          setSetup(null);
          router.refresh();
        }}
      />
    );
  }

  if (props.enabled) {
    return (
      <section className="flex flex-col rounded-card border border-border bg-surface px-4 py-2 wide:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <h2 className="m-0 text-card font-semibold">{ru.security.twoFactorTitle}</h2>
          <EnabledPill />
        </div>
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-y border-border-subtle">
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{ru.security.app}</span>
            {props.enabledOn ? (
              <span className="text-small text-muted">{ru.security.connected(props.enabledOn)}</span>
            ) : null}
          </span>
          <FormDialog
            trigger={<Button variant="danger-text">{ru.security.disable}</Button>}
            title={ru.security.disableTitle}
            description={ru.security.disableText}
            submitLabel={ru.security.disable}
            danger
            onSubmit={async (form) => {
              const result = await disableTwoFactor(null, form);
              if (!result.ok) return passwordError(result.code);
              notify({ tone: 'success', title: ru.security.disabledToast });
              router.refresh();
              return null;
            }}
          >
            <PasswordField />
          </FormDialog>
        </div>
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{ru.security.codesTitle}</span>
            <span className="num text-small text-muted">
              {ru.security.codesLeft(props.backupCodesLeft, props.backupCodesTotal)}
            </span>
          </span>
          <FormDialog
            trigger={
              <Button variant="text" className="px-2 text-caption">
                {ru.security.regenerate}
              </Button>
            }
            title={ru.security.regenerateTitle}
            description={ru.security.regenerateText}
            submitLabel={ru.security.regenerate}
            onSubmit={async (form) => {
              const result = await regenerateBackupCodes(null, form);
              if (!result.ok) return passwordError(result.code);
              notify({ tone: 'success', title: ru.security.regeneratedToast });
              setCodes(result.data.backupCodes);
              return null;
            }}
          >
            <PasswordField />
          </FormDialog>
        </div>
      </section>
    );
  }

  async function begin(form: FormData) {
    setBusy(true);
    setError(null);
    const result = await startTwoFactor(null, form);
    setBusy(false);
    if (!result.ok) setError(passwordError(result.code));
    else setSetup(result.data);
  }

  async function confirm(form: FormData) {
    setBusy(true);
    setError(null);
    const result = await confirmTwoFactor(null, form);
    setBusy(false);
    if (!result.ok) {
      setError(result.code === 'INVALID_INPUT' ? ru.security.codeFormat : ru.security.wrongCode);
      return;
    }
    notify({ tone: 'success', title: ru.security.enabledToast });
    setCodes(result.data.backupCodes);
  }

  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{ru.security.twoFactorTitle}</h2>
        <Pill>{ru.security.off}</Pill>
      </div>

      {!setup ? (
        <form action={begin} className="flex flex-col gap-4">
          <div className="text-pretty text-row text-text-2">{ru.security.setupIntro}</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={ru.security.setupPassword} className="flex-[1_1_200px]" error={error ?? undefined}>
              {(f) => (
                <Input
                  id={f.id}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  invalid={f.invalid}
                  aria-describedby={f.describedBy}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" disabled={busy}>
              {ru.security.setupStart}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-col items-center gap-5 wide:flex-row wide:flex-wrap wide:items-start">
            <QrCode value={setup.totpURI} label={ru.security.qrLabel} size={168} />
            <ol className="m-0 flex flex-[1_1_200px] flex-col gap-2 pl-5 text-row text-text-2">
              {ru.security.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-control bg-surface-2 px-3.5 py-3">
            <span className="num text-row tracking-[0.06em] break-all" data-testid="totp-secret">
              {setup.secret}
            </span>
            <Button
              variant="text"
              className="px-3 text-caption"
              onClick={() =>
                void navigator.clipboard
                  .writeText(setup.secret.replace(/\s/g, ''))
                  .then(() => notify({ tone: 'success', title: ru.security.copied }))
              }
            >
              {ru.security.copyKey}
            </Button>
          </div>
          <form action={confirm} className="flex flex-wrap items-end gap-3">
            <Field label={ru.security.codeLabel} className="flex-[1_1_160px]" error={error ?? undefined}>
              {(f) => (
                <Input
                  id={f.id}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  required
                  mono
                  invalid={f.invalid}
                  aria-describedby={f.describedBy}
                  className="border-border-strong text-[16px] tracking-[0.3em]"
                />
              )}
            </Field>
            <Button type="submit" variant="primary" disabled={busy}>
              {ru.security.enable}
            </Button>
          </form>
          <div className="text-pretty text-caption text-muted">{ru.security.afterEnable}</div>
        </>
      )}
    </section>
  );
}
