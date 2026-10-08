'use client';

import { Dialog } from 'radix-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { issueApiToken, reissueApiToken, revokeApiToken } from '@/server/actions/api-tokens';
import { saveDevSettings } from '@/server/actions/dev-settings';

export const DEV_FORM_ID = 'dev-settings';
type Scope = 'read:data' | 'read:logs' | 'run:sync';
const SCOPES: Scope[] = ['read:data', 'read:logs', 'run:sync'];

export interface DevFormView {
  apiUrl: string;
  token: {
    status: 'active' | 'expired';
    masked: string;
    validity: string;
    lastRequest: string;
    name: string;
    scopes: Scope[];
    localOnly: boolean;
  } | null;
  debug: { enabled: boolean; until: string | null };
  logging: {
    level: 'info' | 'warn' | 'error';
    retentionDays: 7 | 14 | 30;
    externalRequests: boolean;
    authEvents: boolean;
    maskAmounts: boolean;
  };
}

function Check({
  checked,
  onChange,
  label,
  disabled,
  hint,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 items-center gap-2.5',
        disabled ? 'cursor-not-allowed text-faint' : 'cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        className="m-0 size-[18px] shrink-0 accent-accent"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="text-caption text-muted"> · {hint}</span> : null}
      </span>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-muted">{label}</span>
      <span className="num break-all">{value}</span>
    </div>
  );
}

const card = 'flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6';

/** «Разработка» (DevSettings, MDev): token, debug mode and logging; «Сохранить» sits in the page header. */
export function DevForm({ view }: { view: DevFormView }) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(view.token?.name ?? ru.dev.namePlaceholder);
  const [ttl, setTtl] = useState('30d');
  const [scopes, setScopes] = useState<Scope[]>(view.token?.scopes ?? ['read:data', 'read:logs', 'run:sync']);
  const [localOnly, setLocalOnly] = useState(view.token?.localOnly ?? true);
  const [debug, setDebug] = useState(view.debug.enabled);
  const [autoOff, setAutoOff] = useState('24h');
  const [restart, setRestart] = useState(false);
  const [logging, setLogging] = useState(view.logging);
  const [issued, setIssued] = useState<string | null>(null);
  const tokenOn = view.token?.status === 'active';

  const save = () =>
    start(async () => {
      const r = await saveDevSettings(null, {
        debug: { enabled: debug, autoOff, restart },
        logging,
        token: tokenOn ? { name, scopes, localOnly } : null,
      });
      notify(r.ok ? { tone: 'success', title: ru.dev.saved } : { tone: 'error', title: ru.dev.failed });
      if (r.ok) {
        setRestart(false);
        router.refresh();
      }
    });

  const issue = () =>
    start(async () => {
      const r = tokenOn
        ? await reissueApiToken(null, { ttl })
        : await issueApiToken(null, { name, ttl, scopes, localOnly });
      if (r.ok) {
        setIssued(r.data.token);
        router.refresh();
      } else notify({ tone: 'error', title: ru.dev.failed });
    });

  const toggleScope = (s: Scope, on: boolean) =>
    setScopes((list) => (on ? [...new Set([...list, s])] : list.filter((x) => x !== s)));

  return (
    <form
      id={DEV_FORM_ID}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="contents"
    >
      <section className={card} data-testid="api-token-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-card font-semibold">{ru.dev.tokenTitle}</h2>
          <Pill tone={tokenOn ? 'gain' : 'neutral'} className="px-2.5 py-1">
            <span
              className={cn('size-[7px] rounded-full', tokenOn ? 'bg-gain' : 'bg-muted')}
              aria-hidden="true"
            />
            {tokenOn ? ru.dev.tokenActive : view.token ? ru.dev.tokenExpired : ru.dev.tokenNone}
          </Pill>
        </div>
        <div className="text-caption text-pretty text-text-2">{ru.dev.tokenText}</div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3">
          <Field label={ru.dev.name}>
            {(f) => <Input id={f.id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={ru.dev.ttl}>
            {(f) => (
              <Select
                id={f.id}
                value={ttl}
                onValueChange={setTtl}
                options={Object.entries(ru.dev.ttls).map(([value, label]) => ({ value, label }))}
              />
            )}
          </Field>
        </div>
        {view.token ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-control bg-surface-2 px-3.5 py-3">
            <span className="flex flex-col">
              <span className="num text-row" data-testid="api-token-masked">
                {view.token.masked}
              </span>
              <span className="text-small text-muted">{view.token.validity}</span>
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <Button type="button" variant="text" disabled={pending} onClick={issue}>
                {ru.dev.reissue}
              </Button>
              {tokenOn ? (
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="danger-text" disabled={pending}>
                      {ru.dev.revoke}
                    </Button>
                  }
                  title={ru.dev.revokeTitle}
                  description={ru.dev.revokeText}
                  confirmLabel={ru.dev.revoke}
                  danger
                  onConfirm={async () => {
                    const r = await revokeApiToken(null, {});
                    notify(
                      r.ok
                        ? { tone: 'success', title: ru.dev.revoked }
                        : { tone: 'error', title: ru.dev.failed },
                    );
                    router.refresh();
                  }}
                />
              ) : null}
            </span>
          </div>
        ) : (
          <Button
            type="button"
            variant="primary"
            className="self-start"
            disabled={pending || scopes.length === 0 || !name.trim()}
            onClick={issue}
          >
            {ru.dev.issue}
          </Button>
        )}
        <div className="flex flex-col">
          <Check checked={localOnly} onChange={setLocalOnly} label={ru.dev.localOnly} />
          <span className="num pl-7 text-small text-muted">{ru.dev.localRanges}</span>
        </div>
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className="mb-1 p-0 text-small text-muted">{ru.dev.scopesTitle}</legend>
          {SCOPES.map((s) => (
            <Check
              key={s}
              checked={scopes.includes(s)}
              onChange={(on) => toggleScope(s, on)}
              label={ru.dev.scopes[s]!}
            />
          ))}
          <Check checked={false} disabled label={ru.dev.scopes['write:data']!} hint={ru.dev.writeReserved} />
        </fieldset>
        <div className="flex flex-col border-t border-border pt-2 text-row">
          <Row label={ru.dev.apiUrl} value={view.apiUrl} />
          <Row label={ru.dev.apiDocs} value="/api/v1/openapi.json" />
          <Row label={ru.dev.lastRequest} value={view.token?.lastRequest ?? ru.dev.never} />
        </div>
      </section>

      <div className="flex flex-col gap-3 wide:gap-4">
        <section className={card}>
          <h2 className="m-0 text-card font-semibold">{ru.dev.debugTitle}</h2>
          <Check
            checked={debug}
            onChange={(v) => {
              setDebug(v);
              setRestart(true);
            }}
            label={ru.dev.debugEnable}
          />
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-caption text-text-2">
            {ru.dev.debugPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <Field
            label={ru.dev.autoOff}
            hint={view.debug.enabled && view.debug.until ? ru.dev.debugUntil(view.debug.until) : undefined}
          >
            {(f) => (
              <Select
                id={f.id}
                value={autoOff}
                onValueChange={(v) => {
                  setAutoOff(v);
                  setRestart(true);
                }}
                options={Object.entries(ru.dev.autoOffs).map(([value, label]) => ({ value, label }))}
              />
            )}
          </Field>
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.dev.loggingTitle}</h2>
            <Link href="/settings/dev/logs" className="text-caption no-underline">
              {ru.dev.openLogs}
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
            <Field label={ru.dev.level}>
              {(f) => (
                <Select
                  id={f.id}
                  value={logging.level}
                  onValueChange={(v) =>
                    setLogging({ ...logging, level: v as DevFormView['logging']['level'] })
                  }
                  options={Object.entries(ru.dev.levels).map(([value, label]) => ({ value, label }))}
                />
              )}
            </Field>
            <Field label={ru.dev.retention}>
              {(f) => (
                <Select
                  id={f.id}
                  value={String(logging.retentionDays)}
                  onValueChange={(v) => setLogging({ ...logging, retentionDays: Number(v) as 7 | 14 | 30 })}
                  options={Object.entries(ru.dev.retentions).map(([value, label]) => ({ value, label }))}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-col">
            <Check
              checked={logging.externalRequests}
              onChange={(v) => setLogging({ ...logging, externalRequests: v })}
              label={ru.dev.externalRequests}
            />
            <Check
              checked={logging.authEvents}
              onChange={(v) => setLogging({ ...logging, authEvents: v })}
              label={ru.dev.authEvents}
            />
            <Check
              checked={logging.maskAmounts}
              onChange={(v) => setLogging({ ...logging, maskAmounts: v })}
              label={ru.dev.maskAmounts}
            />
          </div>
        </section>
      </div>

      <Dialog.Root open={issued !== null} onOpenChange={(o) => !o && setIssued(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-nav/80" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-32px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-border bg-surface p-6">
            <Dialog.Title className="m-0 text-[18px] font-semibold">{ru.dev.issuedTitle}</Dialog.Title>
            <Dialog.Description className="m-0 text-caption text-text-2">
              {ru.dev.issuedText}
            </Dialog.Description>
            <code
              className="num block rounded-control bg-bg px-3.5 py-3 text-caption break-all"
              data-testid="api-token-plain"
            >
              {issued}
            </code>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(issued ?? '');
                  notify({ tone: 'success', title: ru.dev.copied });
                }}
              >
                {ru.dev.copy}
              </Button>
              <Dialog.Close asChild>
                <Button type="button" variant="primary">
                  {ru.dev.done}
                </Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </form>
  );
}
