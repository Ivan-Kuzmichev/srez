'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { Field, Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import {
  checkNodes,
  removeBlockscoutKey,
  saveBlockscoutKey,
  saveCryptoSettings,
  type NodeHealth,
} from '@/server/actions/crypto-settings';

export const CRYPTO_FORM_ID = 'crypto-settings-form';
const card = 'flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6';
const t = ru.cryptoSettings;

/** «Узлы блокчейна» (CryptoSettings; FR-CRY-7): public nodes only, checked on demand. */
export function NodesCard({ networks }: { networks: string[] }) {
  const [pending, start] = useTransition();
  const [health, setHealth] = useState<NodeHealth[] | null>(null);
  const down = health?.filter((h) => h.state === 'down') ?? [];
  return (
    <section className={card} data-testid="crypto-nodes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{t.nodes}</h2>
        <Button
          variant="secondary-raised"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await checkNodes(null, null);
              if (r.ok) setHealth(r.data);
            })
          }
        >
          {pending ? t.checking : t.checkAll}
        </Button>
      </div>
      <div className="max-w-[720px] text-pretty text-muted">{t.nodesText}</div>
      {health ? (
        <div className="flex flex-col">
          {health.map((h) => (
            <div
              key={h.id}
              className="flex min-h-11 items-center justify-between gap-3 border-t border-border-subtle"
            >
              <span className="text-text-2">{h.name}</span>
              <span
                className={cn(
                  'text-caption',
                  h.state === 'ok' ? 'text-gain' : h.state === 'down' ? 'text-loss' : 'text-muted',
                )}
              >
                {h.state === 'ok' ? t.ok(h.latencyMs ?? 0) : h.state === 'down' ? t.down : t.off}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border-subtle">
          <span className="text-text-2">{networks.join(', ')}</span>
          <span className="text-caption text-muted">{t.notChecked}</span>
        </div>
      )}
      {health ? (
        <div className={cn('text-caption', down.length ? 'text-loss' : 'text-gain')} role="status">
          {down.length ? t.someDown(down.length) : t.allOk}
        </div>
      ) : null}
    </section>
  );
}

/** The Blockscout key for EVM history (decision of 2026-10-09): checked, then stored encrypted. */
export function BlockscoutKeyCard({ last4 }: { last4: string | null }) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  const [key, setKey] = useState('');
  return (
    <section className={card} data-testid="blockscout-key">
      <h2 className="m-0 text-card font-semibold">{t.keyTitle}</h2>
      <div className="text-pretty text-muted">{t.keyText}</div>
      <div className={cn('text-caption', last4 ? 'text-gain' : 'text-muted')}>
        {last4 ? t.keySet(last4) : t.keyNone}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t.keyLabel} className="min-w-64 flex-1">
          {(f) => (
            <Input
              id={f.id}
              type="password"
              mono
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </Field>
        <Button
          variant="primary"
          disabled={pending || key.trim().length < 8}
          onClick={() =>
            start(async () => {
              const r = await saveBlockscoutKey(null, { key });
              if (r.ok) {
                setKey('');
                notify({ tone: 'success', title: t.keySaved });
                router.refresh();
              } else notify({ tone: 'error', title: r.code === 'REFUSED' ? t.keyRefused : t.keyUnreachable });
            })
          }
        >
          {t.keySave}
        </Button>
        {last4 ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await removeBlockscoutKey(null, null);
                notify({ tone: 'success', title: t.keyRemoved });
                router.refresh();
              })
            }
          >
            {t.keyRemove}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** «Цены» and «Спам и мелкие остатки» (FR-SET-5), saved by «Сохранить» in the header. */
export function CryptoSettingsForm({
  initial,
  refreshText,
}: {
  initial: { dustThresholdRub: number; hideUnpriced: boolean; excludeHidden: boolean };
  refreshText: string;
}) {
  const notify = useToast();
  const [, start] = useTransition();
  const [hideUnpriced, setHideUnpriced] = useState(initial.hideUnpriced);
  const [excludeHidden, setExcludeHidden] = useState(initial.excludeHidden);
  return (
    <form
      id={CRYPTO_FORM_ID}
      className="contents"
      action={(form) =>
        start(async () => {
          const r = await saveCryptoSettings(null, {
            dustThresholdRub: form.get('dust'),
            hideUnpriced,
            excludeHidden,
          });
          notify(
            r.ok
              ? { tone: 'success', title: ru.settings.saved }
              : { tone: 'error', title: ru.settings.failed },
          );
        })
      }
    >
      <section className={card}>
        <h2 className="m-0 text-card font-semibold">{t.prices}</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
          <Field label={t.priceSource}>
            {(f) => (
              <Select
                id={f.id}
                value="coingecko"
                onValueChange={() => {}}
                options={[
                  { value: 'coingecko', label: t.sources.coingecko! },
                  { value: 'exchange', label: `${t.sources.exchange} (${t.soon})`, disabled: true },
                ]}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-muted">{t.refresh}</span>
            <span className="flex min-h-11 items-center text-text-2">{refreshText}</span>
          </div>
        </div>
        <div className="text-caption text-pretty text-muted">{t.pricesNote}</div>
      </section>
      <section className={card} data-testid="crypto-spam">
        <h2 className="m-0 text-card font-semibold">{t.spam}</h2>
        <Field label={t.dust} className="max-w-60">
          {(f) => (
            <Input
              id={f.id}
              name="dust"
              type="number"
              min={0}
              step="any"
              mono
              required
              defaultValue={initial.dustThresholdRub}
            />
          )}
        </Field>
        <div className="flex flex-col gap-0.5">
          <Checkbox
            label={t.hideUnpriced}
            checked={hideUnpriced}
            onChange={(e) => setHideUnpriced(e.target.checked)}
          />
          <Checkbox
            label={t.excludeHidden}
            checked={excludeHidden}
            onChange={(e) => setExcludeHidden(e.target.checked)}
          />
        </div>
      </section>
    </form>
  );
}
