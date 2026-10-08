'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { startTinvestImport } from '@/server/actions/onboarding';
import type { OnboardingAccount } from '@/server/onboarding';
import { StepCard } from './steps';

export function AccountsStep({
  accounts,
  unsupported,
}: {
  accounts: OnboardingAccount[];
  unsupported: string[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState(() => new Set(accounts.filter((a) => a.syncEnabled).map((a) => a.id)));
  const [depth, setDepth] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const result = await startTinvestImport(null, { accountIds: [...chosen], depth });
      if (result.ok) router.replace('/onboarding');
      else setError(result.fieldErrors?.accountIds?.[0] ?? result.message ?? ru.settings.failed);
    });

  return (
    <StepCard
      title={ru.onboarding.accountsTitle}
      testId="onboarding-accounts"
      aside={
        <Pill tone="gain" className="px-2.5 py-1">
          <span className="size-[7px] rounded-full bg-gain" aria-hidden="true" />
          {ru.onboarding.tokenOk}
        </Pill>
      }
    >
      <div className="flex flex-col">
        {accounts.map((a) => {
          const on = chosen.has(a.id);
          const when =
            a.closedYear !== null
              ? ru.onboarding.closedIn(a.closedYear)
              : a.openedYear !== null
                ? ru.onboarding.openedIn(a.openedYear)
                : '';
          return (
            <label
              key={a.id}
              className={cn(
                'flex min-h-14 cursor-pointer items-center gap-3 border-b border-border-subtle last:border-b-0',
                !on && 'text-muted',
              )}
            >
              <input
                type="checkbox"
                className="m-0 size-[18px] shrink-0 accent-accent"
                checked={on}
                onChange={() => toggle(a.id)}
              />
              <span className={cn('flex-1', on && 'font-medium')}>{a.name}</span>
              <span className="text-caption text-muted">{when}</span>
            </label>
          );
        })}
        {unsupported.map((name) => (
          <div
            key={name}
            className="flex min-h-14 items-center gap-3 border-b border-border-subtle text-faint last:border-b-0"
          >
            <input type="checkbox" className="m-0 size-[18px] shrink-0" disabled aria-label={name} />
            <span className="flex-1">{name}</span>
            <span className="text-caption">{ru.onboarding.unsupported}</span>
          </div>
        ))}
      </div>
      <Field label={ru.onboarding.depth}>
        {(f) => (
          <Select
            id={f.id}
            value={depth}
            onValueChange={setDepth}
            options={['all', 'year', 'positions'].map((v) => ({ value: v, label: ru.onboarding.depths[v]! }))}
          />
        )}
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap justify-between gap-2">
        <Button asChild variant="secondary">
          <Link href="/onboarding?step=1">{ru.onboarding.back}</Link>
        </Button>
        <Button type="button" variant="primary" disabled={pending || chosen.size === 0} onClick={submit}>
          {ru.onboarding.load}
        </Button>
      </div>
    </StepCard>
  );
}
