import { formatHolding, formatPlain, formatQuantity } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { localDate } from '@/lib/time';
import type { RealizedRow } from './realized-data';

import { csvNumber as num, toCsv } from '@/lib/csv';

/** «Выгрузить в CSV» (FR-ANL-10): semicolons and decimal commas, as a Russian spreadsheet expects. */
export function realizedCsv(rows: readonly RealizedRow[], timeZone: string): string {
  return toCsv(
    ru.realized.csvColumns,
    rows.map((r) => [
      localDate(r.closedAt, timeZone),
      r.ticker ?? '',
      r.name,
      ru.classesShort[r.assetClass] ?? r.assetClass,
      num(formatQuantity(r.quantity)),
      num(formatPlain(r.buyPrice, 2)),
      num(formatPlain(r.sellPrice, 2)),
      String(Math.floor((r.closedAt.getTime() - r.openedAt.getTime()) / 86_400_000)),
      formatHolding(r.openedAt, r.closedAt).replace(/\u00a0/g, ' '),
      num(formatPlain(r.pnl, 2)),
      r.accountName,
    ]),
  );
}
