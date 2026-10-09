import { describe, expect, it } from 'vitest';
import { isoWeek, transitions } from './notify';

const c = (key: string) => ({ key, text: key });

describe('notification transitions', () => {
  it('fires once, stays quiet while active, fires again only after clearing', () => {
    let active = new Set<string>();
    const step = (now: string[]) => {
      const t = transitions(active, now.map(c));
      active = new Set([...[...active].filter((k) => !t.cleared.includes(k)), ...t.fire.map((f) => f.key)]);
      return t.fire.map((f) => f.key);
    };
    expect(step(['limit:a'])).toEqual(['limit:a']);
    expect(step(['limit:a'])).toEqual([]);
    expect(step(['limit:a', 'sync:t'])).toEqual(['sync:t']);
    expect(step(['sync:t'])).toEqual([]);
    expect(step(['limit:a', 'sync:t'])).toEqual(['limit:a']);
    expect(step([])).toEqual([]);
    expect(active.size).toBe(0);
  });

  it('ISO weeks', () => {
    expect(isoWeek('2026-10-05')).toBe('2026-W41');
    expect(isoWeek('2026-10-11')).toBe('2026-W41');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
});
