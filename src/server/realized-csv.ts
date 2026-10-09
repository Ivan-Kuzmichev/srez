import { formatHolding, formatPlain, formatQuantity } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { localDate } from '@/lib/time';
import type { RealizedRow } from './realized-data';

const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
// Spreadsheets read «1 234,5» as text: plain digits with a decimal comma, no grouping.
const num = (v: string) => v.replace(/[\s  ]/g, '').replace('−', '-');

/** «Выгрузить в CSV» (FR-ANL-10): semicolons and decimal commas, as a Russian spreadsheet expects. */
export function realizedCsv(rows: readonly RealizedRow[], timeZone: string): string {
  const lines = [ru.realized.csvColumns.join(';')];
  for (const r of rows)
    lines.push(
      [
        localDate(r.closedAt, timeZone),
        r.ticker ?? '',
        r.name,
        ru.classesShort[r.assetClass] ?? r.assetClass,
        num(formatQuantity(r.quantity)),
        num(formatPlain(r.buyPrice, 2)),
        num(formatPlain(r.sellPrice, 2)),
        String(Math.floor((r.closedAt.getTime() - r.openedAt.getTime()) / 86_400_000)),
        formatHolding(r.openedAt, r.closedAt).replace(/ /g, ' '),
        num(formatPlain(r.pnl, 2)),
        r.accountName,
      ]
        .map(cell)
        .join(';'),
    );
  // A BOM so Excel opens UTF-8 Cyrillic correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}
