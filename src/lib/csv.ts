/** CSV for Russian spreadsheets: semicolons, decimal commas, a BOM so Excel reads UTF-8. */
export const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** «1 234,5» from the shared formatters → «1234,5»: grouping spaces break numbers in a spreadsheet. */
export const csvNumber = (v: string) => v.replace(/[\s\u00a0\u202f]/g, '').replace('−', '-');

export function toCsv(header: readonly string[], rows: readonly string[][]): string {
  return `\ufeff${[header.join(';'), ...rows.map((r) => r.map(csvCell).join(';'))].join('\r\n')}\r\n`;
}
