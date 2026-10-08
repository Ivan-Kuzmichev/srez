import type { AccountChoice, PortfolioFormValues } from '@/components/portfolio/portfolio-form';
import type { Db } from '@/db/client';
import { listAccounts, listTags } from '@/db/queries/accounts';
import { ASSET_CLASS_ORDER } from '@/domain/allocation';
import { ru } from '@/lib/i18n/ru';
import type { PortfolioRow } from './portfolio-data';

export function portfolioChoices(
  db: Db,
  userId: string,
): { accounts: AccountChoice[]; tags: { id: string; name: string }[] } {
  return {
    accounts: listAccounts(db, userId).map((a) => ({
      id: a.id,
      name: a.name,
      sourceLabel: ru.journal.origins[a.sourceKind === 'manual' ? 'manual' : 'tinvest']!,
    })),
    tags: listTags(db, userId),
  };
}

/** Form values for an existing portfolio, or a blank one (no accounts, no targets). */
export function portfolioFormValues(p: PortfolioRow | null, accounts: AccountChoice[]): PortfolioFormValues {
  const modes: PortfolioFormValues['modes'] = {};
  for (const a of accounts) {
    const rule = p?.rules.find((r) => r.accountId === a.id);
    modes[a.id] = rule
      ? { mode: rule.mode, tagId: rule.tagId }
      : { mode: accounts.length === 1 && !p ? 'all' : 'none', tagId: null };
  }
  const text = (v: { toFixed: () => string } | undefined) => (v ? v.toFixed().replace('.', ',') : '');
  return {
    name: p?.name ?? '',
    modes,
    targetsEnabled: p ? p.targetsEnabled : false,
    targets: Object.fromEntries(ASSET_CLASS_ORDER.map((c) => [c, text(p?.targets.get(c))])),
    threshold: p ? text(p.deviationThreshold) : '5',
  };
}
