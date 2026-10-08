'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Pill, type PillTone } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { replaceToken, setAccountSync, syncNow } from '@/server/actions/sources';

export interface TinvestCardView {
  id: string;
  status: 'ok' | 'error' | 'disabled' | 'running';
  error: string | null;
  schedule: string;
  lastSync: string;
  operations: string;
  accounts: { id: string; name: string; syncEnabled: boolean; closed: boolean }[];
}

const tone: Record<TinvestCardView['status'], PillTone> = {
  ok: 'gain',
  error: 'loss',
  disabled: 'neutral',
  running: 'accent',
};
const dot: Record<TinvestCardView['status'], string> = {
  ok: 'bg-gain',
  error: 'bg-loss',
  disabled: 'bg-muted',
  running: 'bg-accent',
};

/** T-Invest on «Источники» (Sources, MSources): status, facts, accounts, sync now, replace token. */
export function TinvestCard({ view, children }: { view: TinvestCardView; children?: React.ReactNode }) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  const [accounts, setAccounts] = useState(view.accounts);

  const sync = () =>
    start(async () => {
      const r = await syncNow(null, { sourceId: view.id });
      notify(
        r.ok
          ? { tone: 'success', title: ru.sources.syncQueued }
          : { tone: 'error', title: ru.settings.failed },
      );
      router.refresh();
    });

  const toggle = (id: string, enabled: boolean) => {
    setAccounts((list) => list.map((a) => (a.id === id ? { ...a, syncEnabled: enabled } : a)));
    start(async () => {
      const r = await setAccountSync(null, { accountId: id, enabled });
      if (!r.ok) {
        setAccounts((list) => list.map((a) => (a.id === id ? { ...a, syncEnabled: !enabled } : a)));
        notify({ tone: 'error', title: ru.settings.failed });
      }
    });
  };

  const replace = (
    <FormDialog
      trigger={<Button variant="secondary">{ru.sources.replaceToken}</Button>}
      title={ru.sources.replaceTitle}
      description={ru.sources.replaceText}
      submitLabel={ru.sources.replaceSave}
      onSubmit={async (form) => {
        const r = await replaceToken(null, { sourceId: view.id, token: form.get('token') });
        if (!r.ok) return r.message ?? ru.onboarding.tokenRequired;
        notify({ tone: 'success', title: ru.sources.replaced });
        router.refresh();
        return null;
      }}
    >
      <Field label={ru.onboarding.tokenLabel}>
        {(f) => (
          <Input
            id={f.id}
            name="token"
            type="password"
            mono
            autoComplete="off"
            spellCheck={false}
            placeholder={ru.onboarding.tokenPlaceholder}
            required
          />
        )}
      </Field>
    </FormDialog>
  );

  const facts: [string, string, boolean?][] = [
    [ru.sources.access, ru.sources.readOnly],
    [ru.sources.schedule, view.schedule],
    [ru.sources.lastSync, view.lastSync],
    [ru.sources.operations, view.operations, true],
  ];

  return (
    <section
      className="flex min-w-0 flex-[3_1_480px] flex-col gap-5 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="tinvest-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 text-[18px] font-semibold">{ru.sources.tinvest}</h2>
          <Pill tone={tone[view.status]} className="px-2.5 py-1">
            <span className={cn('size-[7px] rounded-full', dot[view.status])} aria-hidden="true" />
            {ru.sources.status[view.status]}
          </Pill>
        </div>
        <div className="hidden flex-wrap gap-2 wide:flex">
          <Button variant="secondary-raised" onClick={sync} disabled={pending || view.status === 'running'}>
            {ru.sources.syncNow}
          </Button>
          {replace}
        </div>
      </div>
      {view.status === 'error' && view.error ? (
        <div className="text-caption text-loss">{view.error}</div>
      ) : null}
      <div className="flex flex-col wide:grid wide:grid-cols-[repeat(auto-fit,minmax(130px,1fr))] wide:gap-4">
        {facts.map(([label, value, mono]) => (
          <div
            key={label}
            className="flex flex-col gap-1 max-wide:min-h-11 max-wide:flex-row max-wide:items-center max-wide:justify-between max-wide:border-b max-wide:border-border-subtle"
          >
            <span className="text-small text-muted max-wide:text-row">{label}</span>
            <span className={cn(mono && 'num')}>{value}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border pt-[18px] max-wide:border-t-0 max-wide:pt-0">
        <span className="text-small text-muted">{ru.sources.accountsToSync}</span>
        <div className="flex flex-wrap gap-x-6 gap-y-1 max-wide:flex-col">
          {accounts.map((a) => (
            <label
              key={a.id}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2.5',
                !a.syncEnabled && 'text-muted',
              )}
            >
              <input
                type="checkbox"
                className="m-0 size-[18px] shrink-0 accent-accent"
                checked={a.syncEnabled}
                onChange={(e) => toggle(a.id, e.target.checked)}
              />
              <span>
                {a.name}
                {a.closed ? <span className="text-muted">, {ru.sources.closed}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </div>
      {children}
      <div className="flex flex-col gap-2 wide:hidden">
        <Button variant="secondary-raised" onClick={sync} disabled={pending || view.status === 'running'}>
          {ru.sources.syncNowShort}
        </Button>
        {replace}
      </div>
    </section>
  );
}
