import { formatDate, formatTime } from './format';
import { ru } from './i18n/ru';

/** «сегодня» for today in the display zone, otherwise «5 окт». */
export function dayOrDate(date: Date, timeZone: string, now = new Date()): string {
  return formatDate(date, timeZone) === formatDate(now, timeZone)
    ? ru.security.today
    : formatDate(date, timeZone);
}

/** Last activity: «сейчас» within five minutes, «сегодня, 21:14», «3 окт, 21:14». */
export function activity(date: Date, timeZone: string, now = new Date()): string {
  if (now.getTime() - date.getTime() < 5 * 60_000) return ru.security.now;
  return `${dayOrDate(date, timeZone, now)}, ${formatTime(date, timeZone)}`;
}
