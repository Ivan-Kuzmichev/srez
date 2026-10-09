'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { syncWalletNow } from '@/server/actions/wallets';

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

/** «Кошельки» on the Sources screen: each wallet's state and a manual sync. */
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
            className="flex min-h-[64px] items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span>{w.name}</span>
                <Pill tone={w.ok ? 'gain' : 'loss'}>{w.ok ? t.ok : t.error}</Pill>
              </span>
              <span className="num truncate text-small text-muted">
                {w.address.slice(0, 8)}…{w.address.slice(-6)} · {w.networks}
                {w.balancesOnly ? ` · ${t.balancesOnly}` : ''}
              </span>
              <span className={w.ok ? 'text-small text-muted' : 'text-small text-loss'}>
                {w.error ?? (w.last ? t.last(w.last) : t.never)}
              </span>
            </span>
            <Button
              variant="secondary"
              disabled={pending}
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
              {t.syncNow}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
