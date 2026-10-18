import { getSettings } from './settings';
import { benchmarkFor, benchmarkOptions } from './benchmarks';
import { db } from '@/db/client';
import type { AccountChoice, PortfolioFormValues } from '@/components/portfolio/portfolio-form';
import type { Db } from '@/db/client';
import { listAccounts, listTags } from '@/db/queries/accounts';
import { ASSET_CLASS_ORDER } from '@/domain/allocation';
import { ru } from '@/lib/i18n/ru';
import { and, eq, gt } from 'drizzle-orm';
import { instruments, positions } from '@/db/schema';
import type { PortfolioRow } from './portfolio-data';

/** The common sectors, offered in the form even before anything of them is held. */
const COMMON_SECTORS = [
  'it',
  'financial',
  'energy',
  'materials',
  'consumer',
  'telecom',
  'utilities',
  'health_care',
  'industrials',
  'real_estate',
];

/**
 * Sectors for «Цели по отраслям»: those of the user's shares and funds, the portfolio's targets, then
 * the common ones (FR-PRT-10).
 */
export function sectorChoices(db: Db, userId: string, p: PortfolioRow | null): string[] {
  const held = db
    .select({ meta: instruments.meta })
    .from(positions)
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .where(and(eq(positions.userId, userId), gt(positions.quantity, '0')))
    .all()
    .map((r) => (typeof r.meta?.sector === 'string' ? r.meta.sector : ''))
    .filter((s) => s !== '' && s !== 'government' && s !== 'municipal');
  return [...new Set([...held, ...(p ? [...p.sectorTargets.keys()] : []), ...COMMON_SECTORS])];
}

export function portfolioChoices(
  db: Db,
  userId: string,
): { accounts: AccountChoice[]; tags: { id: string; name: string }[] } {
  return {
    accounts: listAccounts(db, userId).map((a) => ({
      id: a.id,
      name: a.name,
      sourceLabel: ru.journal.sourceKinds[a.sourceKind] ?? a.sourceKind,
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
    sectorTargets: Object.fromEntries([...(p?.sectorTargets ?? new Map())].map(([k, v]) => [k, text(v)])),
    benchmarkId: p?.benchmarkId ?? '',
    deposit: {
      amount: text(p?.depositGoal.amount ?? undefined),
      period: p?.depositGoal.period ?? 'month',
      yearStart: p?.depositGoal.yearStart ?? 1,
      off: !p?.depositGoal.amount,
    },
  };
}

/** The portfolio form's benchmark choice: the settings default first, then each index. */
export function benchmarkChoices(userId: string): { value: string; label: string }[] {
  const options = benchmarkOptions(db());
  const defaultId = benchmarkFor(db(), null, getSettings(db(), userId).returns.defaultBenchmarkId);
  const name = (ticker: string) => ru.benchmarks.full[ticker] ?? ticker;
  const fallback = options.find((o) => o.id === defaultId)!;
  return [
    { value: '', label: ru.portfolio.benchmarkDefault(name(fallback.ticker)) },
    ...options.map((o) => ({ value: o.id, label: name(o.ticker) })),
  ];
}
