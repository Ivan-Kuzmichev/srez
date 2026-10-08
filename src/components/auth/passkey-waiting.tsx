'use client';

import { IconKey } from '@/components/icons';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ru } from '@/lib/i18n/ru';
import { AuthBadge, AuthCard, AuthTitle } from './auth-card';
import type { PasskeyStatus } from './use-passkey';

/** Waiting for the browser's passkey dialog (Passkey mockup). */
export function PasskeyWaiting({
  status,
  onRetry,
  onBack,
}: {
  status: PasskeyStatus;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <AuthCard className="gap-[22px]">
      <AuthBadge tone="accent">
        <IconKey size={28} weight={1.6} />
      </AuthBadge>
      <AuthTitle title={ru.auth.passkeyTitle} text={ru.auth.passkeyText} />
      {status === 'failed' ? (
        <Alert>{ru.auth.passkeyFailed}</Alert>
      ) : (
        <div className="flex items-center gap-3 rounded-control bg-surface-2 px-4 py-3.5" role="status">
          <span className="size-2.5 animate-pulse rounded-full border-2 border-accent" />
          <span>{ru.auth.passkeyWaiting}</span>
        </div>
      )}
      <Button variant="secondary-raised" size="lg" className="border-border-strong" onClick={onRetry}>
        {ru.auth.passkeyRetry}
      </Button>
      <div className="flex flex-col gap-1 border-t border-border pt-4">
        <Button variant="text" className="min-h-11 justify-start" onClick={onBack}>
          {ru.auth.passkeyBack}
        </Button>
        <span className="text-pretty text-caption text-muted">{ru.auth.passkeyNone}</span>
      </div>
    </AuthCard>
  );
}
