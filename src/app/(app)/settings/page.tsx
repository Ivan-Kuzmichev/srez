import type { Metadata } from 'next';
import { GeneralSettingsForm, SETTINGS_FORM_ID } from '@/components/settings/general-form';
import { SettingsHeader } from '@/components/shell/settings-header';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { ru } from '@/lib/i18n/ru';
import { benchmarkFor, benchmarkOptions, NO_BENCHMARK } from '@/server/benchmarks';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.settings };

/** «Общие» (Settings mockup): returns, currencies, prices. Notifications and exports come later. */
export default async function SettingsPage() {
  const session = await requireSession();
  const s = getSettings(db(), session.user.id);
  const benchmarks = [
    ...benchmarkOptions(db()).map((b) => ({ value: b.id, label: ru.benchmarks.names[b.ticker] ?? b.name })),
    { value: NO_BENCHMARK, label: ru.settings.noBenchmark },
  ];
  return (
    <>
      <SettingsHeader
        actions={
          <Button type="submit" form={SETTINGS_FORM_ID} variant="primary">
            {ru.settings.save}
          </Button>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] items-start gap-3 wide:gap-4">
        <GeneralSettingsForm
          initial={{
            returns: {
              ...s.returns,
              defaultBenchmarkId: benchmarkFor(db(), null, s.returns.defaultBenchmarkId) ?? NO_BENCHMARK,
            },
            display: { baseCurrency: s.display.baseCurrency, extraCurrencies: s.display.extraCurrencies },
            prices: s.prices,
          }}
          benchmarks={benchmarks}
        />
      </div>
    </>
  );
}
