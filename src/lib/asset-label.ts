/**
 * How an asset is named in lists: ticker and name, but bonds by name alone («ОФЗ 26238» rather than
 * «SU26238RMFS4»), and assets without a ticker by name.
 */
export function assetLabel(a: { kind: string | null; ticker: string | null; name: string | null }): {
  code: string | null;
  name: string | null;
} {
  if (!a.ticker || a.kind === 'bond') return { code: null, name: a.name };
  return { code: a.ticker, name: a.name };
}
