'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { IconSources } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { syncWalletNow } from '@/server/actions/wallets';
import { WalletMenu } from './wallet-menu';

export interface WalletCardItem {
  id: string;
  name: string;
  ok: boolean;
  error: string | null;
  address: string;
  networks: string;
  balancesOnly: boolean;
  /** «5 минут назад», formatted on the server; null before the first sync. */
  last: string | null;
}

/** «Кошельки» on the Sources screen: each wallet's state, a manual sync, and «⋯» for the rest. */
export function WalletsCard({ wallets }: { wallets: WalletCardItem[] }) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  const t = ru.walletsCard;
  return (
    <section
      className="flex flex-col gap-1 rounded-card border border-border bg-surface px-4 pt-4 pb-1.5 wide:gap-3 wide:p-6"
      data-testid="wallets"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{t.title}</h2>
        <Button asChild variant="secondary-raised">
          <Link href="/sources/wallets/new">{t.add}</Link>
        </Button>
      </div>
      <div className="flex flex-col">
        {wallets.map((w) => (
          <div
            key={w.id}
            className="flex min-h-[64px] items-center gap-3 border-b border-border-subtle py-2 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{w.name}</span>
                <Pill tone={w.ok ? 'gain' : 'loss'} className="shrink-0">
                  {w.ok ? t.ok : t.error}
                </Pill>
              </span>
              <span className="num truncate text-small text-muted">
                {w.address.slice(0, 8)}…{w.address.slice(-6)} · {w.networks}
                {w.balancesOnly ? ` · ${t.balancesOnly}` : ''}
              </span>
              <span className={w.ok ? 'truncate text-small text-muted' : 'text-small text-pretty text-loss'}>
                {w.error ?? (w.last ? t.last(w.last) : t.never)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={t.syncWallet(w.name)}
                title={t.syncNow}
                disabled={pending}
                className="flex size-11 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted hover:text-text disabled:cursor-not-allowed disabled:text-faint"
                onClick={() =>
                  start(async () => {
                    const r = await syncWalletNow(null, { sourceId: w.id });
                    if (r.ok) {
                      notify({ tone: 'success', title: t.queued });
                      router.refresh();
                    }
                  })
                }
              >
                <IconSources size={18} />
              </button>
              <WalletMenu sourceId={w.id} name={w.name} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
