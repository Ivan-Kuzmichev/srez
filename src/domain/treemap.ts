/**
 * «Карта портфеля» (FR-PRT-11): a squarified treemap. Plot geometry only, so plain numbers: the
 * areas are shares, the rectangles are percent of the box.
 */
export interface TreemapRect {
  /** Index in the input. */
  index: number;
  /** Percent of the box width and height. */
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(row: readonly number[], side: number): number {
  const sum = row.reduce((s, v) => s + v, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

/**
 * Rectangles for `values` (largest first works best) in a box of `aspect` = width / height, filling it.
 * Squarified (Bruls, Huizing, van Wijk): rows go along the shorter side while they keep tiles square.
 */
export function squarify(values: readonly number[], aspect: number): TreemapRect[] {
  const items = values.map((v, index) => ({ index, v: Math.max(0, v) })).filter((i) => i.v > 0);
  const total = items.reduce((s, i) => s + i.v, 0);
  if (total === 0) return [];
  // Work in a box of area 1 × aspect so areas and lengths agree.
  const scale = aspect / total;
  const areas = items.map((i) => ({ index: i.index, a: i.v * scale }));
  const out: TreemapRect[] = [];
  let box: Box = { x: 0, y: 0, w: aspect, h: 1 };
  let row: typeof areas = [];

  const place = (r: typeof areas, b: Box): Box => {
    const sum = r.reduce((s, i) => s + i.a, 0);
    if (b.w >= b.h) {
      // A column on the left of the box.
      const w = sum / b.h;
      let y = b.y;
      for (const i of r) {
        const h = i.a / w;
        out.push({ index: i.index, left: b.x, top: y, width: w, height: h });
        y += h;
      }
      return { x: b.x + w, y: b.y, w: b.w - w, h: b.h };
    }
    // A row along the top.
    const h = sum / b.w;
    let x = b.x;
    for (const i of r) {
      const w = i.a / h;
      out.push({ index: i.index, left: x, top: b.y, width: w, height: h });
      x += w;
    }
    return { x: b.x, y: b.y + h, w: b.w, h: b.h - h };
  };

  for (const item of areas) {
    const side = Math.min(box.w, box.h);
    const next = [...row, item];
    if (
      row.length === 0 ||
      worst(
        next.map((i) => i.a),
        side,
      ) <=
        worst(
          row.map((i) => i.a),
          side,
        )
    ) {
      row = next;
    } else {
      box = place(row, box);
      row = [item];
    }
  }
  if (row.length) place(row, box);

  return out
    .map((r) => ({
      index: r.index,
      left: (r.left / aspect) * 100,
      top: r.top * 100,
      width: (r.width / aspect) * 100,
      height: r.height * 100,
    }))
    .sort((a, b) => a.index - b.index);
}

/** The color scale of the map: seven steps from a fall to a rise (docs/08-ui.md, «Карта портфеля»). */
export const HEAT_STEPS = 7;

/** How far each period's scale reaches, percent: a day moves less than a year. */
export const HEAT_RANGE: Record<string, number> = { '1d': 3, '1w': 4, '1m': 6, '6m': 15, '1y': 25, all: 40 };

/**
 * The step of a price change in percent: 3 is no change, 0 a fall past two thirds of the range, 6 a
 * rise as large. Steps start at 1/12, 1/3 and 2/3 of the range (±0,5, 2 and 4 % for a month's ±6 %).
 */
export function heatStep(changePct: number, range: number): number {
  const r = Math.abs(changePct) / range;
  const level = r < 1 / 12 ? 0 : r < 1 / 3 ? 1 : r < 2 / 3 ? 2 : 3;
  return changePct < 0 ? 3 - level : 3 + level;
}
