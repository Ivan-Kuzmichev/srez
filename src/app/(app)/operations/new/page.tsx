import type { Metadata } from 'next';
import Link from 'next/link';
import { OperationForm } from '@/components/ledger/operation-form';
import { FormHeader } from '@/components/shell/form-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { db } from '@/db/client';
import { ru } from '@/lib/i18n/ru';
import { utcToZonedLocal } from '@/lib/time';
import { formChoices } from '@/server/operation-page';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';

export const metadata: Metadata = { title: ru.pages.operationNew };

export default async function NewOperationPage({ searchParams }: PageProps<'/operations/new'>) {
  const session = await requireSession();
  const { accounts, tags } = formChoices(db(), session.user.id);
  const params = await searchParams;
  const header = (
    <FormHeader
      title={ru.operation.newTitle}
      parent={{ href: '/operations', label: ru.pages.operations }}
      current={ru.operation.breadcrumbNew}
      backLabel={ru.operation.back}
    />
  );

  if (accounts.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title={ru.operation.noAccounts}
          actions={
            <div>
              <Button asChild variant="primary">
                <Link href="/sources">{ru.operation.toSources}</Link>
              </Button>
            </div>
          }
        />
      </>
    );
  }

  const preferred =
    accounts.find((a) => a.id === params.account) ?? accounts.find((a) => a.manual) ?? accounts[0]!;
  return (
    <>
      {header}
      <OperationForm
        accounts={accounts}
        tags={tags}
        instrument={null}
        initial={{
          kind: 'buy',
          subtype: '',
          accountId: preferred.id,
          executedAt: utcToZonedLocal(new Date(), getSettings(db(), session.user.id).display.timezone),
          quantity: '',
          price: '',
          currency: preferred.currency,
          fee: '',
          total: '',
          tax: '',
          tagId: '',
          note: '',
        }}
      />
    </>
  );
}
