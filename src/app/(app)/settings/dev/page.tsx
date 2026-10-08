import type { Metadata } from 'next';
import { DEV_FORM_ID, DevForm } from '@/components/dev/dev-form';
import { SettingsHeader } from '@/components/shell/settings-header';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { formatDateYear, formatPlain, formatTime } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { activity } from '@/lib/relative-date';
import { activeToken } from '@/server/api-tokens';
import { env } from '@/server/env';
import { serviceHealth } from '@/server/health';
import { requireSession } from '@/server/session';
import { debugActive, getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.dev };

/** «Разработка» (DevSettings, MDev; FR-DEV-1, 2, 4, 6, 7). */
export default async function DevSettingsPage() {
  const session = await requireSession();
  const userId = session.user.id;
  const settings = getSettings(db(), userId);
  const tz = settings.display.timezone;
  const token = activeToken(db(), userId);
  const now = new Date();
  const expired = token?.expiresAt ? token.expiresAt <= now : false;
  const health = await serviceHealth(db());

  return (
    <>
      <SettingsHeader
        actions={
          <Button type="submit" form={DEV_FORM_ID} variant="primary">
            {ru.settings.save}
          </Button>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] items-start gap-3 wide:gap-4">
        <DevForm
          view={{
            apiUrl: `${env().APP_URL.replace(/\/$/, '')}/api/v1`,
            token: token && {
              status: expired ? 'expired' : 'active',
              masked: `inv_${'•'.repeat(12)}${token.last4}`,
              validity: token.expiresAt
                ? ru.dev.validUntil(formatDateYear(token.expiresAt, tz))
                : ru.dev.noExpiry,
              lastRequest: token.lastUsedAt
                ? `${activity(token.lastUsedAt, tz, now)}, ${token.lastUsedPath?.replace('/api/v1', '') ?? ''}`
                : ru.dev.never,
              name: token.name,
              scopes: token.scopes.filter(
                (s): s is 'read:data' | 'read:logs' | 'run:sync' => s !== 'write:data',
              ),
              localOnly: token.localOnly,
            },
            debug: {
              enabled: debugActive(settings, now.getTime()),
              until: settings.debug.autoOffAt
                ? `${formatDateYear(new Date(settings.debug.autoOffAt), tz)}, ${formatTime(new Date(settings.debug.autoOffAt), tz)}`
                : null,
            },
            logging: settings.logging,
          }}
        />
        <section
          className="col-span-full flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
          data-testid="service-health"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-card font-semibold">{ru.dev.healthTitle}</h2>
            <Button asChild variant="secondary-raised">
              <a href="/settings/dev/report">{ru.dev.report}</a>
            </Button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-8 text-row">
            {[
              [ru.dev.database, health.database.ok ? ru.dev.dbOk : ru.dev.dbFail, !health.database.ok],
              [
                ru.dev.queue,
                ru.dev.queueState(health.queue.queued, health.queue.failedLastDay),
                health.queue.failedLastDay > 0,
              ],
              ...health.external.map(
                (e) =>
                  [
                    ru.dev.external[e.name]!,
                    e.ok && e.latencyMs !== null ? ru.dev.answers(e.latencyMs) : ru.dev.noAnswer,
                    !e.ok,
                  ] as const,
              ),
              [ru.dev.errorsDay, formatPlain(health.errorsLastDay, 0), health.errorsLastDay > 0],
              [ru.dev.version, health.version, false],
            ].map(([label, value, bad]) => (
              <div
                key={String(label)}
                className="flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle"
              >
                <span className="text-muted">{label}</span>
                <span className={bad ? 'num text-loss' : 'num'}>{value}</span>
              </div>
            ))}
          </div>
          <div className="text-caption text-pretty text-muted">{ru.dev.reportNote}</div>
        </section>
      </div>
    </>
  );
}
