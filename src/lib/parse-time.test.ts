import { describe, expect, it } from 'vitest';
import { parseDecimalInput } from './parse';
import { utcToZonedLocal, zonedLocalToUtc } from './time';

describe('parseDecimalInput', () => {
  it('reads numbers as people type them', () => {
    expect(parseDecimalInput('6 120 000')).toBe('6120000');
    expect(parseDecimalInput('0,0100')).toBe('0.01');
    expect(parseDecimalInput('1 234.50')).toBe('1234.5');
    expect(parseDecimalInput('−5')).toBe('-5');
    expect(parseDecimalInput('007')).toBe('7');
    expect(parseDecimalInput('0.000000000000000001')).toBe('0.000000000000000001');
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '1,2,3', '1e5', '--1', '.5', null])
      expect(parseDecimalInput(bad)).toBeNull();
  });
});

describe('time zones', () => {
  it('converts Moscow wall time to UTC and back', () => {
    const utc = zonedLocalToUtc('2026-10-05T19:40', 'Europe/Moscow')!;
    expect(utc.toISOString()).toBe('2026-10-05T16:40:00.000Z');
    expect(utcToZonedLocal(utc, 'Europe/Moscow')).toBe('2026-10-05T19:40');
  });

  it('handles daylight saving time', () => {
    expect(zonedLocalToUtc('2026-07-01T12:00', 'Europe/Berlin')!.toISOString()).toBe(
      '2026-07-01T10:00:00.000Z',
    );
    expect(zonedLocalToUtc('2026-01-01T12:00', 'Europe/Berlin')!.toISOString()).toBe(
      '2026-01-01T11:00:00.000Z',
    );
  });

  it('rejects malformed input', () => {
    expect(zonedLocalToUtc('05.10.2026 19:40', 'UTC')).toBeNull();
  });
});
