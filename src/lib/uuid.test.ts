import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('has the v7 layout and embeds the timestamp', () => {
    const id = uuidv7(Date.UTC(2026, 9, 8, 12, 0, 0));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(Date.UTC(2026, 9, 8, 12, 0, 0));
  });

  it('sorts by time and does not repeat', () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(a < b).toBe(true);
    const many = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(many.size).toBe(1000);
  });
});
