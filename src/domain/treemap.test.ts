import { describe, expect, it } from 'vitest';
import { heatStep, squarify } from './treemap';

const area = (r: { width: number; height: number }) => (r.width * r.height) / 100;

describe('карта портфеля: раскладка', () => {
  it('fills the box, each tile in proportion to its value, none overlapping', () => {
    const values = [570, 427, 387, 381, 375, 328, 230, 110];
    const rects = squarify(values, 1180 / 340);
    expect(rects).toHaveLength(values.length);
    const total = values.reduce((s, v) => s + v, 0);
    rects.forEach((r, i) => expect(area(r)).toBeCloseTo((values[i]! / total) * 100, 6));
    expect(rects.reduce((s, r) => s + area(r), 0)).toBeCloseTo(100, 6);
    for (const r of rects) {
      expect(r.left).toBeGreaterThanOrEqual(-1e-9);
      expect(r.top).toBeGreaterThanOrEqual(-1e-9);
      expect(r.left + r.width).toBeLessThanOrEqual(100 + 1e-9);
      expect(r.top + r.height).toBeLessThanOrEqual(100 + 1e-9);
    }
    for (const a of rects)
      for (const b of rects) {
        if (a === b) continue;
        const apart =
          a.left + a.width <= b.left + 1e-9 ||
          b.left + b.width <= a.left + 1e-9 ||
          a.top + a.height <= b.top + 1e-9 ||
          b.top + b.height <= a.top + 1e-9;
        expect(apart).toBe(true);
      }
  });

  it('one value takes the whole box; nothing gives nothing', () => {
    expect(squarify([5], 3)).toEqual([{ index: 0, left: 0, top: 0, width: 100, height: 100 }]);
    expect(squarify([0, 0], 3)).toEqual([]);
  });
});

describe('эталон 17.1: карта портфеля, цвет', () => {
  it('a month of ±6 %: the mockup steps', () => {
    const m = (v: number) => heatStep(v, 6);
    expect([m(-11.5), m(-7.2), m(-3.4), m(0), m(0.8), m(1.6), m(2.4), m(6.8)]).toEqual([
      0, 0, 1, 3, 4, 4, 5, 6,
    ]);
    expect([m(-0.4), m(0.4), m(-1), m(4)]).toEqual([3, 3, 2, 6]);
  });
});
