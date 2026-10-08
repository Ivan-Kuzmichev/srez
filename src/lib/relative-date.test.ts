import { describe, expect, it } from 'vitest';
import { activity, dayOrDate } from './relative-date';

const now = new Date('2026-10-08T12:00:00Z');

describe('relative dates', () => {
  it('says today or the date', () => {
    expect(dayOrDate(new Date('2026-10-08T01:00:00Z'), 'UTC', now)).toBe('сегодня');
    expect(dayOrDate(new Date('2026-10-03T01:00:00Z'), 'UTC', now)).toBe('3\u00a0окт');
  });

  it('describes activity', () => {
    expect(activity(new Date('2026-10-08T11:58:00Z'), 'UTC', now)).toBe('сейчас');
    expect(activity(new Date('2026-10-08T09:14:00Z'), 'UTC', now)).toBe('сегодня, 09:14');
    expect(activity(new Date('2026-10-03T21:14:00Z'), 'UTC', now)).toBe('3\u00a0окт, 21:14');
  });
});
