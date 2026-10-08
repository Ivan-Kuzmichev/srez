'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ru } from '@/lib/i18n/ru';
import { connectTinvest } from '@/server/actions/onboarding';
import { Note, StepCard } from './steps';

export function TokenStep() {
  const router = useRouter();
  const [state, action, pending] = useActionState(connectTinvest, null);

  useEffect(() => {
    if (!state?.ok) return;
    // DFA accounts are not stored; the next step shows them from the address.
    const params = new URLSearchParams();
    for (const u of state.data.unsupported) params.append('unsupported', u.name);
    router.replace(`/onboarding${params.size ? `?${params}` : ''}`);
  }, [state, router]);

  const error = state && !state.ok ? (state.message ?? state.fieldErrors?.token?.[0]) : undefined;
  return (
    <StepCard title={ru.onboarding.tokenTitle} testId="onboarding-token">
      <ol className="m-0 flex flex-col gap-1.5 pl-5 text-text-2">
        {ru.onboarding.tokenHowTo.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <form action={action} className="flex flex-col gap-5" noValidate>
        <Field label={ru.onboarding.tokenLabel} error={error}>
          {(f) => (
            <Input
              id={f.id}
              aria-describedby={f.describedBy}
              invalid={Boolean(error)}
              name="token"
              type="password"
              mono
              size="lg"
              className="text-row"
              autoComplete="off"
              spellCheck={false}
              placeholder={ru.onboarding.tokenPlaceholder}
              required
            />
          )}
        </Field>
        <Note>{ru.onboarding.tokenNote}</Note>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? ru.onboarding.checking : ru.onboarding.checkToken}
          </Button>
        </div>
      </form>
    </StepCard>
  );
}
