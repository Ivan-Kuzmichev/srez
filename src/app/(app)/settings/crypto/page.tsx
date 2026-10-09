import type { Metadata } from 'next';
import {
  BlockscoutKeyCard,
  CRYPTO_FORM_ID,
  CryptoSettingsForm,
  NodesCard,
} from '@/components/settings/crypto-settings';
import { SettingsHeader } from '@/components/shell/settings-header';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { NETWORKS } from '@/integrations/chains/networks';
import { ru } from '@/lib/i18n/ru';
import { serviceKeyInfo } from '@/server/service-keys';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.crypto };

/** «Крипта» (CryptoSettings, MCrypto; FR-CRY-7, FR-SET-5). */
export default async function CryptoSettingsPage() {
  const session = await requireSession();
  const s = getSettings(db(), session.user.id);
  return (
    <>
      <SettingsHeader
        actions={
          <Button type="submit" form={CRYPTO_FORM_ID} variant="primary">
            {ru.settings.save}
          </Button>
        }
      />
      <NodesCard networks={NETWORKS.map((n) => n.name)} />
      <BlockscoutKeyCard last4={serviceKeyInfo(db(), 'blockscout')?.last4 ?? null} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] items-start gap-3 wide:gap-4">
        <CryptoSettingsForm
          initial={s.crypto}
          refreshText={ru.cryptoSettings.refreshText(
            ru.settings.refreshOptions[String(s.prices.refreshMinutes)]!,
          )}
        />
      </div>
    </>
  );
}
