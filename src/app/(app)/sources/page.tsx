import type { Metadata } from 'next';
import Link from 'next/link';
import { ManualAccountsCard } from '@/components/ledger/manual-accounts-card';
import { PageHeader } from '@/components/shell/page-header';
import { ConnectMore } from '@/components/sources/connect-more';
import { ReconcileStatus } from '@/components/sources/reconcile-status';
import { SyncLog } from '@/components/sources/sync-log';
import { TinvestCard } from '@/components/sources/tinvest-card';
import { WalletsCard } from '@/components/sources/wallets-card';
import { Button } from '@/components/ui/button';
import { db } from '@/db/client';
import { listManualAccounts, listTags } from '@/db/queries/accounts';
import { formatDate, formatPlain } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { ago } from '@/lib/relative-date';
import { requireSession } from '@/server/session';
import { debugActive, getSettings } from '@/server/settings';
import { reconcileSummary, syncLog, tinvestSourceView, walletSources } from '@/server/sources';
import { NETWORKS } from '@/integrations/chains/networks';

export const metadata: Metadata = { title: ru.pages.sources };

/** «Источники» (Sources, MSources): T-Invest, manual accounts, what else to connect, the sync log. */
export default async function SourcesPage() {
  const session = await requireSession();
  const userId = session.user.id;
  const tz = getSettings(db(), userId).display.timezone;
  const tinvest = tinvestSourceView(db(), userId);
  const wallets = walletSources(db(), userId);
  const accounts = listManualAccounts(db(), userId).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    operations: a.operations,
    last: a.lastOperationAt ? formatDate(a.lastOperationAt, tz) : null,
  }));

  return (
    <>
      <PageHeader
        title={ru.pages.sources}
        backToMenu
        actions={
          <Button asChild variant="primary" className="max-wide:hidden">
            <Link href={tinvest ? '#connect' : '/onboarding'}>{ru.sources.connect}</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap gap-3 wide:gap-4">
        {tinvest ? (
          <TinvestCard
            view={{
              id: tinvest.id,
              status: tinvest.status,
              error: tinvest.lastError,
              schedule: ru.sources.every(tinvest.scheduleMinutes),
              lastSync: tinvest.lastSyncAt ? ago(tinvest.lastSyncAt, tz) : ru.sources.never,
              operations: formatPlain(tinvest.operations, 0),
              accounts: tinvest.accounts,
            }}
          >
            {tinvest.lastSyncAt ? (
              <ReconcileStatus
                summary={reconcileSummary(db(), tinvest.id)}
                href={`/sources/${tinvest.id}/reconcile`}
              />
            ) : null}
          </TinvestCard>
        ) : (
          <section className="flex min-w-0 flex-[3_1_480px] flex-col items-start gap-3 rounded-card border border-border bg-surface p-4 wide:p-6">
            <h2 className="m-0 text-[18px] font-semibold">{ru.sources.notConnected}</h2>
            <div className="text-caption text-pretty text-muted">{ru.sources.notConnectedText}</div>
            <Button asChild variant="primary">
              <Link href="/onboarding">{ru.sources.connectTinvest}</Link>
            </Button>
          </section>
        )}
        <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-3 wide:gap-4">
          {wallets.length > 0 ? (
            <WalletsCard
              wallets={wallets.map((w) => ({
                id: w.id,
                name: w.name,
                ok: w.status !== 'error',
                error: w.status === 'error' ? w.lastError : null,
                address: w.address,
                networks: w.networks.map((n) => NETWORKS.find((x) => x.id === n)?.name ?? n).join(', '),
                balancesOnly: w.mode === 'balances',
                last: w.lastSyncAt ? ago(w.lastSyncAt, tz) : null,
              }))}
            />
          ) : null}
          <ManualAccountsCard accounts={accounts} tags={listTags(db(), userId)} />
          <ConnectMore />
        </div>
      </div>
      <SyncLog rows={syncLog(db(), userId)} timeZone={tz} debug={debugActive(getSettings(db(), userId))} />
    </>
  );
}
