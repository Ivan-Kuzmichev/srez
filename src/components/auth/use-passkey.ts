'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { authClient } from '@/lib/auth-client';

const noop = () => () => {};

/** Passkeys need a secure context (HTTPS or localhost) and WebAuthn in the browser. False on the server. */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(
    noop,
    () => window.isSecureContext && typeof window.PublicKeyCredential === 'function',
    () => false,
  );
}

export type PasskeyStatus = 'idle' | 'waiting' | 'failed';

/** Runs the passkey sign-in ceremony and goes to `next` on success. */
export function usePasskeySignIn(next: string, options: { autoFill?: boolean } = {}) {
  const router = useRouter();
  const [status, setStatus] = useState<PasskeyStatus>('idle');

  const finish = useCallback(() => {
    router.replace(next);
    router.refresh();
  }, [next, router]);

  const start = useCallback(async () => {
    setStatus('waiting');
    const result = await authClient.signIn.passkey();
    if (result?.error) setStatus('failed');
    else finish();
  }, [finish]);

  // Browser autofill offers saved passkeys in the username field (conditional UI).
  useEffect(() => {
    if (!options.autoFill) return;
    let cancelled = false;
    void (async () => {
      const pkc = window.PublicKeyCredential;
      if (!pkc?.isConditionalMediationAvailable || !(await pkc.isConditionalMediationAvailable())) return;
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (!cancelled && result && !result.error) finish();
    })();
    return () => {
      cancelled = true;
    };
  }, [finish, options.autoFill]);

  return { status, start, reset: () => setStatus('idle') };
}
