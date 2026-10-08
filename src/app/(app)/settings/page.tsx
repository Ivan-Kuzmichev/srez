import type { Metadata } from 'next';
import { PricesCard, SETTINGS_FORM_ID } from '@/components/settings/prices-card';
import { SettingsHeader } from '@/components/shell/settings-header';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { ru } from '@/lib/i18n/ru';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.settings };

/** Phase 3: prices only; the other sections of the Settings mockup arrive with their phases. */
export default async function SettingsPage() {
  const session = await requireSession();
  const s = getSettings(db(), session.user.id);
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
        <PricesCard refreshMinutes={s.prices.refreshMinutes} snapshotTime={s.prices.snapshotTime} />
        <div className="text-pretty text-caption text-muted wide:pt-6">{ru.settings.laterSections}</div>
      </div>
    </>
  );
}
