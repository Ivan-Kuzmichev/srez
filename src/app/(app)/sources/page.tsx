import type { Metadata } from 'next';
import { ManualAccountsCard } from '@/components/ledger/manual-accounts-card';
import { PageHeader } from '@/components/shell/page-header';
import { db } from '@/db/client';
import { listManualAccounts, listTags } from '@/db/queries/accounts';
import { DEFAULT_TIME_ZONE } from '@/lib/app';
import { formatDate } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { requireSession } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.sources };

/** Phase 2: manual accounts only. Т-Инвестиции, wallets and the sync log arrive in phases 4 and 8. */
export default async function SourcesPage() {
  const session = await requireSession();
  const accounts = listManualAccounts(db(), session.user.id).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    operations: a.operations,
    last: a.lastOperationAt ? formatDate(a.lastOperationAt, DEFAULT_TIME_ZONE) : null,
  }));
  return (
    <>
      <PageHeader title={ru.pages.sources} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-3 wide:gap-4">
        <ManualAccountsCard accounts={accounts} tags={listTags(db(), session.user.id)} />
        <div className="text-pretty text-caption text-muted wide:pt-6">{ru.accounts.laterPhase}</div>
      </div>
    </>
  );
}
