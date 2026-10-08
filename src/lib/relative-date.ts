import { formatDate } from './format';
import { ru } from './i18n/ru';

/** «сегодня» for today in the display zone, otherwise «5 окт». */
export function dayOrDate(date: Date, timeZone: string, now = new Date()): string {
  return formatDate(date, timeZone) === formatDate(now, timeZone)
    ? ru.security.today
    : formatDate(date, timeZone);
}
