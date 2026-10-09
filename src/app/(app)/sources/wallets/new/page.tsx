import type { Metadata } from 'next';
import Link from 'next/link';
import { WalletForm } from '@/components/wallet/wallet-form';
import { db } from '@/db/client';
import { Money } from '@/domain/money';
import { NETWORKS } from '@/integrations/chains/networks';
import { formatMoney } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';
import { walletAccountChoices } from '@/server/wallets';

export const metadata: Metadata = { title: ru.pages.walletNew };

/** «Кошелёк по адресу» (Wallet, MWallet). */
export default async function NewWalletPage() {
  const session = await requireSession();
  const settings = getSettings(db(), session.user.id);
  return (
    <>
      <header className="flex flex-col gap-3 wide:mb-2">
        <div className="hidden items-center gap-2 text-caption text-muted wide:flex">
          <Link href="/sources" className="no-underline">
            {ru.pages.sources}
          </Link>
          <span>/</span>
          <span>{ru.wallet.breadcrumb}</span>
        </div>
        <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">
          {ru.wallet.title}
        </h1>
        <div className="text-pretty text-muted">
          <span className="wide:hidden">{ru.wallet.introShort}</span>
          <span className="max-wide:hidden">{ru.wallet.intro}</span>
        </div>
      </header>
      <WalletForm
        networks={NETWORKS.filter((n) => n.family === 'evm' && !n.disabled).map((n) => ({
          id: n.id,
          name: n.name,
          history: n.history,
        }))}
        disabled={NETWORKS.filter((n) => n.disabled).map((n) => ({ id: n.id, name: n.name }))}
        accounts={walletAccountChoices(db(), session.user.id)}
        threshold={formatMoney(Money.of(settings.crypto.dustThresholdRub, 'RUB'))}
        timeZone={settings.display.timezone}
      />
    </>
  );
}
