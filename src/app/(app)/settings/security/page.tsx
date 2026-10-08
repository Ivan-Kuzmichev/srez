import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PasskeysCard } from '@/components/security/passkeys-card';
import { listPasskeys } from '@/db/queries/security';
import { parseUserAgent } from '@/lib/user-agent';
import { SettingsHeader } from '@/components/shell/settings-header';
import { TwoFactorCard } from '@/components/security/two-factor-card';
import { db } from '@/db/client';
import { DEFAULT_TIME_ZONE } from '@/lib/app';
import { ru } from '@/lib/i18n/ru';
import { dayOrDate } from '@/lib/relative-date';
import { auth } from '@/server/auth';
import { twoFactorStatus } from '@/server/security';
import { requireSession } from '@/server/session';
import { BACKUP_CODES_COUNT } from '@/server/two-factor';

export const metadata: Metadata = { title: ru.pages.security };

export default async function SecurityPage() {
  const session = await requireSession();
  const twoFactor = await twoFactorStatus(auth(), db(), session.user.id);
  const tz = DEFAULT_TIME_ZONE;
  const passkeys = listPasskeys(db(), session.user.id).map((p) => ({
    id: p.id,
    name: p.name,
    added: p.createdAt ? dayOrDate(p.createdAt, tz) : ru.common.none,
    lastUsed: p.lastUsedAt ? dayOrDate(p.lastUsedAt, tz) : null,
  }));
  const device = parseUserAgent((await headers()).get('user-agent')).device ?? ru.security.passkeyDefaultName;

  return (
    <>
      <SettingsHeader />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] items-start gap-3 wide:gap-4">
        <TwoFactorCard
          enabled={twoFactor.enabled}
          enabledOn={twoFactor.enabledAt ? dayOrDate(twoFactor.enabledAt, tz) : null}
          backupCodesLeft={twoFactor.backupCodesLeft}
          backupCodesTotal={BACKUP_CODES_COUNT}
        />
        <div className="flex flex-col gap-3 wide:gap-4">
          <PasskeysCard passkeys={passkeys} defaultName={device} />
        </div>
      </div>
    </>
  );
}
