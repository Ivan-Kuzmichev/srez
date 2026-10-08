'use client';

import { useState } from 'react';
import { Field, Input } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { savePriceSettings } from '@/server/actions/settings';

export const SETTINGS_FORM_ID = 'settings-form';

/** «Цены и курсы» from the Settings mockup; saved by «Сохранить» in the page header. */
export function PricesCard({
  refreshMinutes,
  snapshotTime,
}: {
  refreshMinutes: number;
  snapshotTime: string;
}) {
  const notify = useToast();
  const [refresh, setRefresh] = useState(String(refreshMinutes));

  return (
    <form
      id={SETTINGS_FORM_ID}
      action={async (form) => {
        const result = await savePriceSettings(null, {
          refreshMinutes: refresh,
          snapshotTime: form.get('snapshotTime'),
        });
        notify(
          result.ok
            ? { tone: 'success', title: ru.settings.saved }
            : { tone: 'error', title: ru.settings.failed },
        );
      }}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 wide:p-6"
    >
      <h2 className="m-0 text-card font-semibold">{ru.settings.pricesTitle}</h2>
      <div className="flex flex-col">
        {[
          [ru.settings.sourcesSecurities, ru.settings.sourcesSecuritiesValue],
          [ru.settings.sourcesCrypto, 'CoinGecko'],
          [ru.settings.sourcesFx, ru.settings.sourcesFxValue],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex min-h-11 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
          >
            <span className="text-muted">{label}</span>
            <span className="text-right">{value}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
        <Field label={ru.settings.refresh}>
          {(f) => (
            <Select
              id={f.id}
              value={refresh}
              onValueChange={setRefresh}
              options={['15', '60', '1440'].map((v) => ({ value: v, label: ru.settings.refreshOptions[v]! }))}
            />
          )}
        </Field>
        <Field label={ru.settings.snapshot}>
          {(f) => (
            <Input
              id={f.id}
              name="snapshotTime"
              type="time"
              mono
              required
              defaultValue={snapshotTime}
              className="[color-scheme:dark]"
            />
          )}
        </Field>
      </div>
    </form>
  );
}
