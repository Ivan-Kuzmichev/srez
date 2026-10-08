import { listAccounts, listTags } from '@/db/queries/accounts';
import type { Db } from '@/db/client';
import type { AccountChoice } from '@/components/ledger/operation-form';

/** Data both operation form pages need. */
export function formChoices(
  db: Db,
  userId: string,
): { accounts: AccountChoice[]; tags: { id: string; name: string }[] } {
  return {
    accounts: listAccounts(db, userId).map((a) => ({
      id: a.id,
      name: a.name,
      manual: a.sourceKind === 'manual',
      currency: a.currency,
    })),
    tags: listTags(db, userId),
  };
}
