import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { PasskeysCard } from '@/components/security/passkeys-card';
import { PasswordCard } from '@/components/security/password-card';
import { SessionsCard } from '@/components/security/sessions-card';
import { TwoFactorCard } from '@/components/security/two-factor-card';
import { SettingsHeader } from '@/components/shell/settings-header';
import { db } from '@/db/client';
import { listActiveSessions, listPasskeys } from '@/db/queries/security';
import { formatDateLong } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { activity, dayOrDate } from '@/lib/relative-date';
import { describeUserAgent, parseUserAgent } from '@/lib/user-agent';
import { auth, PASSWORD_MIN_LENGTH } from '@/server/auth';
import { twoFactorStatus } from '@/server/security';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';
import { BACKUP_CODES_COUNT } from '@/server/two-factor';

export const metadata: Metadata = { title: ru.pages.security };

export default async function SecurityPage() {
  const session = await requireSession();
  const tz = getSettings(db(), session.user.id).display.timezone;
  const userId = session.user.id;
  const login = session.user.displayUsername ?? session.user.username ?? session.user.name;

  const twoFactor = await twoFactorStatus(auth(), db(), userId);
  const passkeys = listPasskeys(db(), userId).map((p) => ({
    id: p.id,
    name: p.name,
    added: p.createdAt ? dayOrDate(p.createdAt, tz) : ru.common.none,
    lastUsed: p.lastUsedAt ? dayOrDate(p.lastUsedAt, tz) : null,
  }));
  const sessions = listActiveSessions(db(), userId).map((s) => ({
    id: s.id,
    device: describeUserAgent(s.userAgent) ?? ru.security.unknownDevice,
    method: ru.security.method[s.loginMethod ?? ''] ?? ru.common.none,
    ip: s.ipAddress || ru.common.none,
    activity: s.id === session.session.id ? ru.security.now : activity(s.updatedAt, tz),
    current: s.id === session.session.id,
  }));
  const device = parseUserAgent((await headers()).get('user-agent')).device ?? ru.security.passkeyDefaultName;
  const passwordChangedAt = (session.user as { passwordChangedAt?: Date | string | null }).passwordChangedAt;

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
          <PasswordCard
            login={login}
            changed={passwordChangedAt ? formatDateLong(new Date(passwordChangedAt), tz) : null}
            minLength={PASSWORD_MIN_LENGTH}
          />
          <PasskeysCard passkeys={passkeys} defaultName={device} />
        </div>
      </div>
      <SessionsCard sessions={sessions} />
    </>
  );
}
