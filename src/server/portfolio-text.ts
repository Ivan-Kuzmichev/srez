import { ru } from '@/lib/i18n/ru';
import type { PortfolioRow } from './portfolio-data';

/** «Брокерский по тегу «пенсия», Кошелёк» or «Счёт ИИС целиком». */
export function describeRules(
  p: PortfolioRow,
  accountNames: Map<string, string>,
  tagNames: Map<string, string>,
): string {
  const parts = p.rules.map((r) => {
    const name = accountNames.get(r.accountId) ?? '';
    return r.mode === 'tag' ? ru.portfolios.byTag(name, tagNames.get(r.tagId ?? '') ?? '') : name;
  });
  if (p.rules.length === 1 && p.rules[0]!.mode === 'all') return ru.portfolios.wholeSingle(parts[0]!);
  return parts.join(', ');
}
