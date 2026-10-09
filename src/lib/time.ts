// Building a formatter costs far more than using one: one per time zone (phase 10, NFR-4).
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// Offsets change only at DST switches, on the hour: one lookup per zone and UTC hour is exact.
const offsets = new Map<string, number>();

/** Offset of `timeZone` from UTC at `date`, in minutes (Moscow: +180). */
function offsetMinutes(date: Date, timeZone: string): number {
  const key = `${timeZone}|${Math.floor(date.getTime() / 3_600_000)}`;
  const known = offsets.get(key);
  if (known !== undefined) return known;
  if (offsets.size > 100_000) offsets.clear();
  const value = computeOffset(date, timeZone);
  offsets.set(key, value);
  return value;
}

function computeOffset(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** «2026-10-05T19:40» as wall time in `timeZone` → the UTC instant. Null for malformed input. */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return null;
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  // Two passes settle the offset around DST changes.
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** The UTC instant as «2026-10-05T19:40» wall time in `timeZone`, for datetime-local inputs. */
export function utcToZonedLocal(date: Date, timeZone: string): string {
  const shifted = new Date(date.getTime() + offsetMinutes(date, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** Calendar date «YYYY-MM-DD» of an instant in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  return utcToZonedLocal(date, timeZone).slice(0, 10);
}

/** «YYYY-MM-DD» plus `days` (may be negative). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to` inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
