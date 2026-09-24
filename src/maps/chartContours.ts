/** Chart contours of a baked heightfield: the coastline and elevation bands, traced once per
 * field and drawn by the navigation and deployment charts as SVG paths in chart metres (the
 * charts place them with the battle's offset). Renderer-free, like the rest of `src/maps`. */
import { OPEN_SEA_M, type Heightfield } from './heightfield';

/** The coast, then relief bands a naval chart shades, metres above the sea. */
export const CHART_LEVELS_M = [0, 100, 300, 600, 1000] as const;
/** Every second sample: 80 m cells follow a cove at the charts' closest zoom and trace in tens of milliseconds. */
const STRIDE = 2;
/** Simplification tolerance, metres: a quarter cell, below a pixel at every chart scale. */
const TOLERANCE_M = 20;

export interface ChartContour {
  /** Height the contour encloses, metres: 0 is the coastline. */
  level: number;
  /** Every closed loop at this level as one SVG path in chart metres. Fill it with the even-odd rule: nested loops
   * alternate land, lake and island. */
  path: string;
}

const traced = new WeakMap<Heightfield, readonly ChartContour[]>();
/** The field's contours at `CHART_LEVELS_M`, lowest first, skipping levels no land reaches. Cached per field. */
export function chartContours(field: Heightfield): readonly ChartContour[] {
  let contours = traced.get(field);
  if (!contours) {
    const grid = downsample(field);
    contours = CHART_LEVELS_M.flatMap(level => {
      const loops = traceLevel(grid, level).map(loop => simplifyLoop(loop, TOLERANCE_M)).filter(loop => loop.length >= 6);
      return loops.length ? [{ level, path: loops.map(svgLoop).join('') }] : [];
    });
    traced.set(field, contours);
  }
  return contours;
}

interface Grid { columns: number; rows: number; cell: number; originX: number; originZ: number; heights: Float32Array }
/** Every `STRIDE`th sample with a ring of open sea around it, so each contour closes inside the grid. */
function downsample(field: Heightfield): Grid {
  const inner = (count: number) => Math.floor((count - 1) / STRIDE) + 1;
  const columns = inner(field.columns) + 2, rows = inner(field.rows) + 2, cell = field.cell * STRIDE;
  const heights = new Float32Array(columns * rows).fill(OPEN_SEA_M);
  for (let j = 1; j < rows - 1; j++) for (let i = 1; i < columns - 1; i++) heights[j * columns + i] = field.sample((i - 1) * STRIDE, (j - 1) * STRIDE);
  return { columns, rows, cell, originX: field.originX - cell, originZ: field.originZ - cell, heights };
}

/** Marching squares: every closed loop where the bilinear surface crosses `level`, as flat [x0, z0, x1, z1, …] in chart metres.
 * A crossing lives on a cell edge (2 × vertex index, +1 for the edge running down from that vertex) that exactly two cells
 * share, so the segments chain into loops through that edge. Saddles split by the cell's mean. */
function traceLevel(grid: Grid, level: number): number[][] {
  const { columns, rows, heights } = grid;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const from = links.get(a); if (from) from.push(b); else links.set(a, [b]);
    const to = links.get(b); if (to) to.push(a); else links.set(b, [a]);
  };
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < columns - 1; i++) {
    const at = j * columns + i;
    const a = heights[at], b = heights[at + 1], c = heights[at + columns + 1], d = heights[at + columns];
    const index = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
    if (index === 0 || index === 15) continue;
    // Edges of this cell: top, right, bottom, left.
    const top = 2 * at, right = 2 * (at + 1) + 1, bottom = 2 * (at + columns), left = 2 * at + 1;
    switch (index) {
      case 1: case 14: link(left, top); break;
      case 2: case 13: link(top, right); break;
      case 3: case 12: link(left, right); break;
      case 4: case 11: link(right, bottom); break;
      case 6: case 9: link(top, bottom); break;
      case 7: case 8: link(left, bottom); break;
      case 5: case 10: {
        // Diagonal corners share a side of the level: the mean says whether the middle joins them.
        const joined = (a + b + c + d) / 4 >= level === (index === 5);
        if (joined) { link(left, bottom); link(top, right); } else { link(left, top); link(right, bottom); }
        break;
      }
    }
  }
  const point = (edge: number, out: number[]) => {
    const vertex = edge >> 1, i = vertex % columns, j = (vertex - i) / columns, down = edge & 1;
    const from = heights[vertex], to = heights[down ? vertex + columns : vertex + 1];
    const t = Math.max(0, Math.min(1, (level - from) / (to - from)));
    out.push(grid.originX + (i + (down ? 0 : t)) * grid.cell, grid.originZ + (j + (down ? t : 0)) * grid.cell);
  };
  const loops: number[][] = [];
  for (const start of links.keys()) {
    if (!links.get(start)!.length) continue;
    const loop: number[] = [];
    let previous = -1, edge = start;
    for (;;) {
      point(edge, loop);
      const next = links.get(edge)!;
      const onward = next[0] !== previous || next.length < 2 ? next[0] : next[1];
      next.length = 0;
      previous = edge; edge = onward;
      if (edge === start || !links.get(edge)?.length) break;
    }
    loops.push(loop);
  }
  return loops;
}

/** Douglas–Peucker on a closed loop, split at its first point and the point farthest from it. */
function simplifyLoop(loop: number[], tolerance: number): number[] {
  const count = loop.length / 2;
  if (count < 4) return loop;
  let far = 0, farthest = -1;
  for (let k = 1; k < count; k++) {
    const distance = (loop[2 * k] - loop[0]) ** 2 + (loop[2 * k + 1] - loop[1]) ** 2;
    if (distance > farthest) { farthest = distance; far = k; }
  }
  const keep = new Uint8Array(count + 1);
  keep[0] = keep[far] = keep[count] = 1;
  const at = (k: number) => (k % count) * 2;
  const stack = [0, far, far, count];
  while (stack.length) {
    const last = stack.pop()!, first = stack.pop()!;
    if (last - first < 2) continue;
    const ax = loop[at(first)], az = loop[at(first) + 1], bx = loop[at(last)], bz = loop[at(last) + 1];
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    let worst = -1, worstDistance = tolerance;
    for (let k = first + 1; k < last; k++) {
      const px = loop[at(k)] - ax, pz = loop[at(k) + 1] - az;
      const distance = length > 1e-9 ? Math.abs(dx * pz - dz * px) / length : Math.hypot(px, pz);
      if (distance > worstDistance) { worstDistance = distance; worst = k; }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push(first, worst, worst, last);
  }
  const kept: number[] = [];
  for (let k = 0; k < count; k++) if (keep[k]) kept.push(loop[2 * k], loop[2 * k + 1]);
  return kept;
}

/** One closed loop in relative whole-metre steps. */
function svgLoop(loop: number[]): string {
  let x = Math.round(loop[0]), z = Math.round(loop[1]), path = `M${x} ${z}`;
  for (let k = 2; k < loop.length; k += 2) {
    const nx = Math.round(loop[k]), nz = Math.round(loop[k + 1]);
    if (nx === x && nz === z) continue;
    path += `l${nx - x} ${nz - z}`;
    x = nx; z = nz;
  }
  return path + 'z';
}
