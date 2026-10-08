'use client';

import { useActionState, useState } from 'react';
import { IconKey, IconLock } from '@/components/icons';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { Field, Input } from '@/components/ui/field';
import { ru } from '@/lib/i18n/ru';
import type { ActionResult } from '@/server/action';
import { signInWithPassword } from '@/server/actions/auth';
import { AuthBadge, AuthCard, AuthTitle, OrDivider } from './auth-card';
import { Countdown } from './countdown';
import { PasskeyWaiting } from './passkey-waiting';
import { usePasskeySignIn, usePasskeySupport } from './use-passkey';

type View = 'form' | 'passkey';

export function LoginScreen({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    signInWithPassword,
    null,
  );
  const [view, setView] = useState<View>('form');
  const [lockDismissed, setLockDismissed] = useState<string | null>(null);
  const passkeys = usePasskeySupport();
  const passkey = usePasskeySignIn(next, { autoFill: passkeys });

  const startPasskey = () => {
    setView('passkey');
    void passkey.start();
  };

  if (view === 'passkey') {
    return (
      <PasskeyWaiting
        status={passkey.status}
        onRetry={() => void passkey.start()}
        onBack={() => {
          passkey.reset();
          setView('form');
        }}
      />
    );
  }

  const failure = state && !state.ok ? state : null;
  const lockedUntil = failure?.code === 'LOCKED' ? String(failure.details?.lockedUntil) : null;

  if (lockedUntil && lockDismissed !== lockedUntil) {
    return (
      <AuthCard className="gap-[22px]">
        <AuthBadge tone="danger">
          <IconLock size={28} weight={1.6} />
        </AuthBadge>
        <AuthTitle title={ru.auth.lockedTitle} text={ru.auth.lockedText} />
        <div className="flex items-center justify-between gap-3 rounded-control bg-surface-2 px-4 py-3.5">
          <span className="text-muted">{ru.auth.lockedWait}</span>
          <Countdown until={new Date(lockedUntil)} onDone={() => setLockDismissed(lockedUntil)} />
        </div>
        {passkeys ? (
          <Button variant="primary" size="lg" onClick={startPasskey}>
            <IconKey />
            {ru.auth.signInPasskey}
          </Button>
        ) : null}
        <div className="border-t border-border pt-4 text-pretty text-caption text-muted">
          {ru.auth.lockedHint}
        </div>
      </AuthCard>
    );
  }

  let error: string | null = notice ?? null;
  if (failure?.code === 'INVALID_CREDENTIALS') {
    const remaining = Number(failure.details?.remaining ?? 0);
    error =
      remaining > 0 && remaining < 5
        ? `${ru.auth.invalidCredentials} ${ru.auth.attemptsLeft(remaining)}`
        : ru.auth.invalidCredentials;
  } else if (failure?.code === 'RATE_LIMITED') error = ru.auth.rateLimited;
  else if (failure?.code === 'INVALID_INPUT') error = ru.auth.invalidCredentials;

  return (
    <>
      <AuthCard>
        <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em]">{ru.auth.loginTitle}</h1>
        {error ? <Alert>{error}</Alert> : null}
        <form
          key={failure ? JSON.stringify(failure.details) : 'initial'}
          action={formAction}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="next" value={next} />
          <Field label={ru.auth.username}>
            {(f) => (
              <Input
                id={f.id}
                name="username"
                defaultValue={
                  typeof failure?.details?.username === 'string' ? failure.details.username : undefined
                }
                size="lg"
                autoComplete="username webauthn"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus={!failure}
              />
            )}
          </Field>
          <Field label={ru.auth.password}>
            {(f) => (
              <Input
                id={f.id}
                name="password"
                type="password"
                size="lg"
                autoComplete="current-password"
                required
                autoFocus={Boolean(failure)}
              />
            )}
          </Field>
          <Checkbox name="remember" label={ru.auth.remember} />
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {ru.auth.signIn}
          </Button>
        </form>
        {passkeys ? (
          <>
            <OrDivider label={ru.auth.or} />
            <Button
              variant="secondary-raised"
              size="lg"
              className="border-border-strong"
              onClick={startPasskey}
            >
              <IconKey />
              {ru.auth.signInPasskey}
            </Button>
          </>
        ) : null}
      </AuthCard>
      <div className="text-center text-pretty text-caption text-muted">{ru.auth.forgot}</div>
    </>
  );
}
