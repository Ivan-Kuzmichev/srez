'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { Field, Input } from '@/components/ui/field';
import { FormDialog } from '@/components/ui/form-dialog';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { connectTelegram, disconnectTelegram, testTelegram } from '@/server/actions/notify';

export interface NotifyState {
  connected: boolean;
  lastError: string | null;
  /** «5 минут назад», formatted on the server. */
  lastSent: string | null;
  events: { payout: boolean; syncError: boolean; weekly: boolean };
  thresholds: { deviationPp: number; dayMovePct: number };
}

const t = ru.notify;

/** «Уведомления в Telegram» (Settings, MSettings; FR-NTF-1, 2). Events and thresholds go with «Сохранить». */
export function NotifyCard({
  state,
  events,
  onEvents,
}: {
  state: NotifyState;
  events: NotifyState['events'];
  onEvents: (e: NotifyState['events']) => void;
}) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  const ok = state.connected && !state.lastError;
  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="settings-notify"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{t.title}</h2>
        <Pill tone={state.connected ? (ok ? 'gain' : 'loss') : 'neutral'} className="px-2.5 py-1">
          <span
            className={`size-[7px] rounded-full ${state.connected ? (ok ? 'bg-gain' : 'bg-loss') : 'bg-muted'}`}
            aria-hidden="true"
          />
          <span className="wide:hidden">{state.connected ? t.connectedShort : t.notConnected}</span>
          <span className="max-wide:hidden">{state.connected ? t.connected : t.notConnected}</span>
        </Pill>
      </div>
      {state.connected && state.lastError ? (
        <div className="text-caption text-loss">{t.failed[state.lastError]}</div>
      ) : null}
      {state.connected && !state.lastError && state.lastSent ? (
        <div className="text-caption text-muted">{t.lastSent(state.lastSent)}</div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {state.connected ? (
          <>
            <Button
              variant="secondary-raised"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await testTelegram(null, null);
                  notify({ tone: 'success', title: t.testQueued });
                  setTimeout(() => router.refresh(), 3000);
                })
              }
            >
              {t.sendTest}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await disconnectTelegram(null, null);
                  notify({ tone: 'success', title: t.disconnected });
                  router.refresh();
                })
              }
            >
              {t.disconnect}
            </Button>
          </>
        ) : (
          <FormDialog
            trigger={<Button variant="secondary-raised">{t.connect}</Button>}
            title={t.connectTitle}
            description={t.connectText}
            submitLabel={t.connectSubmit}
            onSubmit={async (form) => {
              const r = await connectTelegram(null, form);
              if (!r.ok)
                return r.code === 'INVALID_INPUT' ? t.failed.TOKEN! : (t.failed[r.code] ?? t.failed.NETWORK!);
              notify({ tone: 'success', title: t.connectedToast });
              router.refresh();
              return null;
            }}
          >
            <Field label={t.token}>
              {(f) => <Input id={f.id} name="token" type="password" mono autoComplete="off" required />}
            </Field>
            <Field label={t.chatId}>
              {(f) => <Input id={f.id} name="chatId" mono inputMode="numeric" autoComplete="off" required />}
            </Field>
          </FormDialog>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {(['payout', 'syncError', 'weekly'] as const).map((k) => (
          <Checkbox
            key={k}
            label={
              <>
                <span className="wide:hidden">{t.eventsShort[k]}</span>
                <span className="max-wide:hidden">{t.events[k]}</span>
              </>
            }
            checked={events[k]}
            onChange={(e) => onEvents({ ...events, [k]: e.target.checked })}
          />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3">
        <Field
          label={
            <>
              <span className="wide:hidden">{t.deviationShort}</span>
              <span className="max-wide:hidden">{t.deviation}</span>
            </>
          }
        >
          {(f) => (
            <Input
              id={f.id}
              name="deviationPp"
              type="number"
              min={0.1}
              max={100}
              step="any"
              mono
              required
              defaultValue={state.thresholds.deviationPp}
            />
          )}
        </Field>
        <Field
          label={
            <>
              <span className="wide:hidden">{t.dayMoveShort}</span>
              <span className="max-wide:hidden">{t.dayMove}</span>
            </>
          }
        >
          {(f) => (
            <Input
              id={f.id}
              name="dayMovePct"
              type="number"
              min={0.1}
              max={100}
              step="any"
              mono
              required
              defaultValue={state.thresholds.dayMovePct}
            />
          )}
        </Field>
      </div>
    </section>
  );
}
