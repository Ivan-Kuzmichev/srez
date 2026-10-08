'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { IconAlert } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import type { ActionResult } from '@/server/action';
import { verifySecondFactor } from '@/server/actions/auth';
import { AuthCard, AuthTitle } from './auth-card';
import { PasskeyWaiting } from './passkey-waiting';
import { usePasskeySignIn, usePasskeySupport } from './use-passkey';

/** Second sign-in step (TwoFactor, TwoFactorError mockups). */
export function TwoFactorScreen({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    verifySecondFactor,
    null,
  );
  const [backup, setBackup] = useState(false);
  // Controlled: React resets uncontrolled fields after a form action, the mockup keeps the typed code.
  const [code, setCode] = useState('');
  const [passkeyView, setPasskeyView] = useState(false);
  const passkeys = usePasskeySupport();
  const passkey = usePasskeySignIn(next);

  if (passkeyView) {
    return (
      <PasskeyWaiting
        status={passkey.status}
        onRetry={() => void passkey.start()}
        onBack={() => {
          passkey.reset();
          setPasskeyView(false);
        }}
      />
    );
  }

  const failure = state && !state.ok ? state : null;
  const remaining = Number(failure?.details?.remaining ?? 0);
  let error: string | null = null;
  if (failure?.code === 'INVALID_CODE' && failure.fieldErrors) error = ru.auth.codeFormat;
  else if (failure?.code === 'INVALID_CODE') error = ru.auth.codeWrong(remaining);
  else if (failure?.code === 'INVALID_BACKUP_CODE') error = ru.auth.backupWrong(remaining);
  else if (failure?.code === 'RATE_LIMITED') error = ru.auth.rateLimited;
  const errorId = 'second-factor-error';

  return (
    <>
      <AuthCard>
        <AuthTitle
          title={ru.auth.twoFactorTitle}
          text={backup ? ru.auth.twoFactorBackupText : ru.auth.twoFactorText}
        />
        <form action={formAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />
          {backup ? <input type="hidden" name="backup" value="true" /> : null}
          <div className="flex flex-col gap-2">
            <label
              className={cn('flex flex-col gap-1.5 text-small', error ? 'text-loss-text' : 'text-muted')}
            >
              {backup ? ru.auth.backupLabel : ru.auth.codeLabel}
              <input
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode={backup ? 'text' : 'numeric'}
                maxLength={backup ? 12 : 6}
                pattern={backup ? undefined : '[0-9]{6}'}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                autoCapitalize="characters"
                className={cn(
                  'num box-border min-h-[60px] w-full rounded-control border bg-bg px-3.5 text-center text-[28px] text-text',
                  backup ? 'tracking-[0.15em] uppercase' : 'tracking-[0.4em]',
                  error ? 'border-loss' : 'border-border-strong',
                )}
              />
            </label>
            {error ? (
              <div id={errorId} role="alert" className="flex items-start gap-2 text-row text-loss-text">
                <span className="flex pt-0.5">
                  <IconAlert />
                </span>
                <span>{error}</span>
              </div>
            ) : null}
            {!backup && error ? (
              <div className="text-pretty text-caption text-muted">{ru.auth.codeHint}</div>
            ) : null}
          </div>
          {!error ? (
            <Checkbox name="trust" label={ru.auth.trust} />
          ) : (
            <input type="hidden" name="trust" value="false" />
          )}
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {ru.auth.confirm}
          </Button>
        </form>
        <div className="flex flex-col border-t border-border pt-2">
          <Button
            variant="text"
            className="min-h-11 justify-start"
            onClick={() => {
              setBackup((v) => !v);
              setCode('');
            }}
          >
            {backup ? ru.auth.useTotp : ru.auth.useBackup}
          </Button>
          {passkeys ? (
            <Button
              variant="text"
              className="min-h-11 justify-start"
              onClick={() => {
                setPasskeyView(true);
                void passkey.start();
              }}
            >
              {ru.auth.confirmPasskey}
            </Button>
          ) : null}
        </div>
      </AuthCard>
      <div className="text-center text-caption">
        <Link href="/login" className="inline-flex min-h-11 items-center no-underline">
          {ru.auth.otherUser}
        </Link>
      </div>
    </>
  );
}
