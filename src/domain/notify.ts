/** FR-NTF-3: an event goes once; again only after its condition cleared and came back. */
export interface Condition {
  /** Stable for one condition: «limit:singleStock:<instrument>», «sync:<source>», «payout:<operation>». */
  key: string;
  text: string;
}

export function transitions(
  active: ReadonlySet<string>,
  now: readonly Condition[],
): { fire: Condition[]; cleared: string[] } {
  const current = new Set(now.map((c) => c.key));
  return {
    fire: now.filter((c) => !active.has(c.key)),
    cleared: [...active].filter((k) => !current.has(k)),
  };
}

/** ISO week of a local date «YYYY-MM-DD»: the weekly summary's key. */
export function isoWeek(date: string): string {
  // The week belongs to the year of its Thursday; week 1 holds the year's first Thursday.
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
