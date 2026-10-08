import { formatDate, formatTime } from './format';
import { plural, ru } from './i18n/ru';

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

/** «только что», «5 минут назад», «2 часа назад», then the date with the time. */
export function ago(date: Date, timeZone: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  return activity(date, timeZone, now);
}
