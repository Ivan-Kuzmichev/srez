/**
 * Number typed by a person: «6 120 000», «0,0100», «1 234.5», «−5». Returns a plain decimal string
 * («6120000», «0.01»), or null if it is not a number. No float conversion anywhere.
 */
export function parseDecimalInput(input: string | null | undefined): string | null {
  if (input == null) return null;
  const cleaned = String(input)
    .trim()
    .replace(/[\s  ]/g, '')
    .replace(/−/g, '-')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const [int = '0', frac] = cleaned.replace(/^(-?)0+(?=\d)/, '$1').split('.');
  const trimmed = frac?.replace(/0+$/, '');
  return trimmed ? `${int}.${trimmed}` : int;
}
