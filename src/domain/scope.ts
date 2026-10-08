/**
 * A calculation area (docs/04-calculations.md, section 3): a set of cells (account, tag). A portfolio
 * takes an account whole (`all`) or one of its tags (`tag`); «everything» takes every account whole.
 */
export interface ScopeRule {
  accountId: string;
  mode: 'all' | 'tag';
  tagId: string | null;
}

export type Scope = (accountId: string, tagId: string | null) => boolean;

export function scopeOf(rules: readonly ScopeRule[]): Scope {
  const byAccount = new Map(rules.map((r) => [r.accountId, r]));
  return (accountId, tagId) => {
    const rule = byAccount.get(accountId);
    if (!rule) return false;
    return rule.mode === 'all' || rule.tagId === tagId;
  };
}

export const everything: Scope = () => true;
