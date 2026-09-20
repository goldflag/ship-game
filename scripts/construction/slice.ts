import type { Box, ReferenceMesh, ReferenceMeta, Vec3 } from './reference';
import { selectTriangles } from './reference';

/** Measurements over a cached reference mesh: plane sections, silhouette top lines, up-facing area by height,
 * hull cross sections with deck-line detection, and vertical probes. Pure geometry — no rendering, no files. */
export type Point2 = [number, number];
export type Axis = 'x' | 'y' | 'z';
export interface MeshView {
  positions: Float32Array;
  index: Uint32Array;
  ranges: { first: number; count: number }[];
}
export const meshView = (mesh: ReferenceMesh, selection?: string[]): MeshView => ({ positions: mesh.positions, index: mesh.index, ranges: selectTriangles(mesh.meta, selection) });

/** Calls `visit` once per selected triangle with a reusable 9-number corner array. */
export function forEachTriangle(view: MeshView, visit: (corners: Float64Array) => void) {
  const corners = new Float64Array(9);
  for (const range of view.ranges)
    for (let t = range.first; t < range.first + range.count; t++)
      for (let c = 0; c < 3; c++) {
        const at = view.index[t * 3 + c] * 3;
        corners[c * 3] = view.positions[at];
        corners[c * 3 + 1] = view.positions[at + 1];
        corners[c * 3 + 2] = view.positions[at + 2];
        if (c === 2) visit(corners);
      }
}
export const triangleCount = (view: MeshView) => view.ranges.reduce((sum, range) => sum + range.count, 0);
/** The two remaining axes of a plane cut, ordered so the picture reads the way the views do. */
export const sectionAxes = (axis: Axis): [number, number] => (axis === 'y' ? [0, 2] : axis === 'z' ? [0, 1] : [2, 1]);
const inBox = (box: Box | undefined, p: ArrayLike<number>, at = 0) =>
  !box || (p[at] >= box.min[0] && p[at] <= box.max[0] && p[at + 1] >= box.min[1] && p[at + 1] <= box.max[1] && p[at + 2] >= box.min[2] && p[at + 2] <= box.max[2]);

/** Segments where the plane `axis = value` crosses the mesh, in the two remaining axes. */
export function planeSegments(view: MeshView, axis: Axis, value: number, box?: Box): Point2[][] {
  const index = 'xyz'.indexOf(axis);
  const [u, v] = sectionAxes(axis);
  const segments: Point2[][] = [];
  const centre = new Float64Array(3);
  forEachTriangle(view, (corners) => {
    for (let i = 0; i < 3; i++) centre[i] = (corners[i] + corners[3 + i] + corners[6 + i]) / 3;
    if (!inBox(box, centre)) return;
    const hits: Point2[] = [];
    for (let e = 0; e < 3; e++) {
      const a = e * 3;
      const b = ((e + 1) % 3) * 3;
      const da = corners[a + index] - value;
      const db = corners[b + index] - value;
      if (da < 0 === db < 0) continue;
      const t = da / (da - db);
      hits.push([corners[a + u] + (corners[b + u] - corners[a + u]) * t, corners[a + v] + (corners[b + v] - corners[a + v]) * t]);
    }
    if (hits.length === 2 && (hits[0][0] !== hits[1][0] || hits[0][1] !== hits[1][1])) segments.push(hits);
  });
  return segments;
}

/** Chain shared endpoints into rings. Open chains are returned too, so a leaking source mesh still measures. */
export function chainLoops(segments: Point2[][], tolerance = 1e-4): { points: Point2[]; closed: boolean }[] {
  const nodes: Point2[] = [];
  const byKey = new Map<string, number>();
  const at = (p: Point2) => {
    const key = Math.round(p[0] / tolerance) + ':' + Math.round(p[1] / tolerance);
    let found = byKey.get(key);
    if (found === undefined) {
      found = nodes.length;
      nodes.push(p);
      byKey.set(key, found);
    }
    return found;
  };
  const links: number[][] = [];
  const edges: [number, number][] = [];
  for (const [a, b] of segments) {
    const [i, j] = [at(a), at(b)];
    if (i === j) continue;
    const id = edges.length;
    edges.push([i, j]);
    (links[i] ??= []).push(id);
    (links[j] ??= []).push(id);
  }
  const used = new Array<boolean>(edges.length).fill(false);
  const loops: { points: Point2[]; closed: boolean }[] = [];
  const step = (node: number): number => {
    for (const id of links[node] ?? []) if (!used[id]) return id;
    return -1;
  };
  for (let seed = 0; seed < edges.length; seed++) {
    if (used[seed]) continue;
    used[seed] = true;
    const start = edges[seed][0];
    let node = edges[seed][1];
    const points: Point2[] = [nodes[start], nodes[node]];
    for (;;) {
      if (node === start) break;
      const next = step(node);
      if (next < 0) break;
      used[next] = true;
      node = edges[next][0] === node ? edges[next][1] : edges[next][0];
      points.push(nodes[node]);
    }
    const closed = node === start;
    if (closed) points.pop();
    if (points.length >= (closed ? 3 : 2)) loops.push({ points, closed });
  }
  return loops;
}

export const polygonArea = (ring: Point2[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    sum += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return sum / 2;
};
export const pathLength = (points: Point2[], closed = false): number => {
  let sum = 0;
  for (let i = 0; i + 1 < points.length; i++) sum += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  if (closed && points.length > 2) sum += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  return sum;
};
export const boundsOf = (points: Point2[]): [Point2, Point2] => [
  [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
  [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
];
/** Ramer–Douglas–Peucker, used the way the scratch tool used shapely's `simplify`. */
export function simplifyPath(points: Point2[], epsilon: number): Point2[] {
  if (epsilon <= 0 || points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = 0;
    let at = -1;
    const [ax, ay] = points[from];
    const [bx, by] = points[to];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = from + 1; i < to; i++) {
      const distance = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / length;
      if (distance > worst) [worst, at] = [distance, i];
    }
    if (worst > epsilon && at > 0) {
      keep[at] = true;
      stack.push([from, at], [at, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export interface PlanPolygon {
  area: number;
  perimeter: number;
  thicknessM: number;
  bounds: { min: Point2; max: Point2 };
  ring: Point2[];
  closed: boolean;
}
/** Footprint rings of the solid at height `y`, in (x, z). Thin rails and ladders drop out below `minThickness`,
 * which stands in for the scratch tool's negative-then-positive buffer. */
export function planPolygons(view: MeshView, y: number, options: { box?: Box; minArea?: number; minThickness?: number; simplify?: number } = {}): PlanPolygon[] {
  const minArea = options.minArea ?? 1;
  const minThickness = options.minThickness ?? 0.3;
  const loops = chainLoops(planeSegments(view, 'y', y, options.box));
  const found: PlanPolygon[] = [];
  for (const loop of loops) {
    if (!loop.closed) continue;
    const area = Math.abs(polygonArea(loop.points));
    const perimeter = pathLength(loop.points, true);
    const thickness = perimeter > 0 ? (4 * area) / perimeter : 0;
    if (area < minArea || thickness < minThickness) continue;
    const ring = options.simplify ? simplifyPath([...loop.points, loop.points[0]], options.simplify).slice(0, -1) : loop.points;
    const [min, max] = boundsOf(ring);
    found.push({ area: round(area, 2), perimeter: round(perimeter, 2), thicknessM: round(thickness, 3), bounds: { min: round2(min), max: round2(max) }, ring: ring.map(round2), closed: true });
  }
  return found.sort((a, b) => b.area - a.area);
}

/** Highest surface along each step of an axis, from the triangle corners inside the box. */
export function topLine(view: MeshView, along: Axis, step: number, box?: Box): { at: number; top: number | null; bottom: number | null }[] {
  const index = 'xyz'.indexOf(along);
  const buckets = new Map<number, [number, number]>();
  forEachTriangle(view, (corners) => {
    for (let c = 0; c < 3; c++) {
      const p = [corners[c * 3], corners[c * 3 + 1], corners[c * 3 + 2]];
      if (!inBox(box, p)) continue;
      const key = Math.round(p[index] / step);
      const entry = buckets.get(key);
      if (!entry) buckets.set(key, [p[1], p[1]]);
      else {
        entry[0] = Math.max(entry[0], p[1]);
        entry[1] = Math.min(entry[1], p[1]);
      }
    }
  });
  const from = box ? Math.round(box.min[index] / step) : Math.min(...buckets.keys());
  const to = box ? Math.round(box.max[index] / step) : Math.max(...buckets.keys());
  const rows = [];
  for (let key = from; key <= to; key++) {
    const entry = buckets.get(key);
    rows.push({ at: round(key * step, 3), top: entry ? round(entry[0], 2) : null, bottom: entry ? round(entry[1], 2) : null });
  }
  return rows;
}
/** Half-breadth of the geometry per height band: the deck-by-deck width the front view shows. */
export function widthBands(view: MeshView, binM: number, box?: Box): { y: number; xMin: number; xMax: number; halfBreadth: number }[] {
  const buckets = new Map<number, [number, number]>();
  forEachTriangle(view, (corners) => {
    for (let c = 0; c < 3; c++) {
      const p = [corners[c * 3], corners[c * 3 + 1], corners[c * 3 + 2]];
      if (!inBox(box, p)) continue;
      const key = Math.floor(p[1] / binM);
      const entry = buckets.get(key);
      if (!entry) buckets.set(key, [p[0], p[0]]);
      else {
        entry[0] = Math.min(entry[0], p[0]);
        entry[1] = Math.max(entry[1], p[0]);
      }
    }
  });
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, [xMin, xMax]]) => ({ y: round(key * binM, 3), xMin: round(xMin, 2), xMax: round(xMax, 2), halfBreadth: round(Math.max(Math.abs(xMin), Math.abs(xMax)), 2) }));
}

export interface LevelRow {
  y: number;
  areaM2: number;
  xRange: Point2;
  zRange: Point2;
}
/** Up-facing (or, with `down`, underside) surface area by height: the deck-level finder. */
export function levelHistogram(view: MeshView, options: { box?: Box; binM?: number; minAreaM2?: number; down?: boolean; facing?: number } = {}): LevelRow[] {
  const bin = options.binM ?? 0.1;
  const minArea = options.minAreaM2 ?? 2;
  const facing = options.facing ?? 0.7;
  const buckets = new Map<number, { area: number; x: Point2; z: Point2 }>();
  const centre = new Float64Array(3);
  forEachTriangle(view, (corners) => {
    for (let i = 0; i < 3; i++) centre[i] = (corners[i] + corners[3 + i] + corners[6 + i]) / 3;
    if (!inBox(options.box, centre)) return;
    const [ux, uy, uz] = [corners[3] - corners[0], corners[4] - corners[1], corners[5] - corners[2]];
    const [vx, vy, vz] = [corners[6] - corners[0], corners[7] - corners[1], corners[8] - corners[2]];
    const normal: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(...normal);
    if (!length) return;
    const up = normal[1] / length;
    if (options.down ? up > -facing : up < facing) return;
    const key = Math.floor(centre[1] / bin);
    const entry = buckets.get(key) ?? { area: 0, x: [Infinity, -Infinity] as Point2, z: [Infinity, -Infinity] as Point2 };
    entry.area += (length / 2) * Math.abs(up);
    entry.x = [Math.min(entry.x[0], centre[0]), Math.max(entry.x[1], centre[0])];
    entry.z = [Math.min(entry.z[0], centre[2]), Math.max(entry.z[1], centre[2])];
    buckets.set(key, entry);
  });
  return [...buckets.entries()]
    .filter(([, entry]) => entry.area >= minArea)
    .sort((a, b) => a[0] - b[0])
    .map(([key, entry]) => ({ y: round((key + 0.5) * bin, 3), areaM2: round(entry.area, 1), xRange: round2(entry.x), zRange: round2(entry.z) }));
}

export interface Crossing {
  y: number;
  facing: 'up' | 'down' | 'side';
}
/** Every surface a downward ray at (x, z) crosses, highest first: the vertical probe. */
export function probeColumn(view: MeshView, x: number, z: number): Crossing[] {
  const hits: Crossing[] = [];
  forEachTriangle(view, (c) => {
    const [ax, az, bx, bz, cx, cz] = [c[0], c[2], c[3], c[5], c[6], c[8]];
    const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    const d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
    const d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) return;
    const total = d1 + d2 + d3;
    if (Math.abs(total) < 1e-12) return;
    const y = (d2 * c[1] + d3 * c[4] + d1 * c[7]) / total;
    const [ux, uy, uz] = [c[3] - c[0], c[4] - c[1], c[5] - c[2]];
    const [vx, vy, vz] = [c[6] - c[0], c[7] - c[1], c[8] - c[2]];
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(...normal) || 1;
    const up = normal[1] / length;
    hits.push({ y: round(y, 3), facing: up > 0.5 ? 'up' : up < -0.5 ? 'down' : 'side' });
  });
  return hits.sort((a, b) => b.y - a.y);
}
/** The nearest up-facing surface at or below `y`, then the nearest above it: what `ship:place --y` should be given. */
export function nearestDeck(crossings: Crossing[], y: number): { below?: number; above?: number; nearest?: number } {
  const decks = crossings.filter((hit) => hit.facing === 'up').map((hit) => hit.y);
  const below = decks.filter((value) => value <= y + 1e-6).sort((a, b) => b - a)[0];
  const above = decks.filter((value) => value > y + 1e-6).sort((a, b) => a - b)[0];
  const nearest = [below, above].filter((value) => value !== undefined).sort((a, b) => Math.abs(a! - y) - Math.abs(b! - y))[0];
  return { below, above, nearest };
}

export interface DeckLevel {
  y: number;
  halfBreadth: number;
  runs: [number, number][];
}
/** Long horizontal runs in a cross section, merged per height: candidate deck lines at this station. */
export function horizontalLevels(segments: Point2[][], options: { tolerance?: number; minLength?: number; quantum?: number } = {}): DeckLevel[] {
  const tolerance = options.tolerance ?? 0.02;
  const minLength = options.minLength ?? 3;
  const quantum = options.quantum ?? 0.05;
  const byHeight = new Map<number, [number, number][]>();
  for (const [a, b] of segments) {
    if (Math.abs(b[1] - a[1]) >= tolerance || Math.abs(b[0] - a[0]) <= 0.05) continue;
    const y = Math.round((a[1] + b[1]) / 2 / quantum) * quantum;
    (byHeight.get(y) ?? byHeight.set(y, []).get(y)!).push([Math.min(a[0], b[0]), Math.max(a[0], b[0])]);
  }
  const levels: DeckLevel[] = [];
  for (const [y, spans] of [...byHeight.entries()].sort((a, b) => a[0] - b[0])) {
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [[...spans[0]] as [number, number]];
    for (const [low, high] of spans.slice(1)) {
      const last = merged[merged.length - 1];
      if (low <= last[1] + 0.15) last[1] = Math.max(last[1], high);
      else merged.push([low, high]);
    }
    const runs = merged.filter(([low, high]) => high - low >= minLength);
    if (runs.length) levels.push({ y: round(y, 3), halfBreadth: round(Math.max(...runs.map(([low, high]) => Math.min(-low, high))), 3), runs: runs.map(round2) });
  }
  return levels;
}

export interface Station {
  z: number;
  deckY: number;
  keelY: number;
  halfBreadth: number;
  /** Deck edge down the side to the keel centreline, in (x, y) with x ≥ 0. */
  half: Point2[];
  areaM2: number;
}
/** Widest offset from the centreline at height `y`, over every cut segment: the outer shell, whatever internal
 * structure the source mesh also cut. Source hulls are rarely watertight, so no closed ring is required. */
export function sectionHalfBreadth(segments: Point2[][], y: number): number {
  let width = 0;
  for (const [a, b] of segments) {
    const low = Math.min(a[1], b[1]);
    const high = Math.max(a[1], b[1]);
    if (y < low - 1e-9 || y > high + 1e-9) continue;
    if (high - low < 1e-9) width = Math.max(width, Math.abs(a[0]), Math.abs(b[0]));
    else width = Math.max(width, Math.abs(a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1]))));
  }
  return width;
}
/** The hull cross section at station `z`: the deck line, the starboard half outline down to the keel, and the area.
 * The outline is sampled by height rather than walked around a ring, because World of Warships hull meshes are open
 * shells; everything above the deck line is dropped, so masts, boats and superstructure never enter the hull. */
export function hullStation(view: MeshView, z: number, options: { minRunLength?: number; maxDeckY?: number; samples?: number; box?: Box } = {}): Station | undefined {
  const segments = planeSegments(view, 'z', z, options.box);
  if (segments.length < 3) return undefined;
  const levels = horizontalLevels(segments, { minLength: options.minRunLength ?? 2 });
  const points = segments.flat();
  const widest = Math.max(...points.map((p) => Math.abs(p[0])));
  if (!(widest > 0)) return undefined;
  // The deck is the highest long horizontal run that still spans most of the section's beam.
  const deck = [...levels]
    .sort((a, b) => b.y - a.y)
    .find((level) => (options.maxDeckY === undefined || level.y <= options.maxDeckY) && level.halfBreadth >= 0.85 * widest && level.halfBreadth >= 1);
  if (!deck) return undefined;
  const below = points.filter((p) => p[1] <= deck.y + 1e-6);
  if (below.length < 3) return undefined;
  const keelY = Math.min(...below.map((p) => p[1]));
  if (!(deck.y - keelY > 0.5)) return undefined;
  const samples = Math.min(Math.max(options.samples ?? 32, 5), 200);
  const half: Point2[] = [];
  for (let i = 0; i <= samples; i++) {
    const y = deck.y - ((deck.y - keelY) * i) / samples;
    half.push([round(Math.min(sectionHalfBreadth(segments, y), widest), 4), round(y, 4)]);
  }
  // Trapezoidal integration of the sampled half-breadth, doubled for both sides.
  let area = 0;
  for (let i = 0; i + 1 < half.length; i++) area += (half[i][0] + half[i + 1][0]) * (half[i][1] - half[i + 1][1]);
  return {
    z: round(z, 3), deckY: round(deck.y, 3), keelY: round(keelY, 3), halfBreadth: round(Math.max(...half.map((p) => p[0])), 3),
    half, areaM2: round(area, 2),
  };
}
/** Half-breadth of a station's outline at each sampled height, the profile a sectional-area comparison needs. */
export function halfBreadthAt(half: Point2[], y: number): number {
  let width = 0;
  for (let i = 0; i + 1 < half.length; i++) {
    const [a, b] = [half[i], half[i + 1]];
    const low = Math.min(a[1], b[1]);
    const high = Math.max(a[1], b[1]);
    if (y < low - 1e-9 || y > high + 1e-9) continue;
    const t = Math.abs(b[1] - a[1]) < 1e-9 ? 0 : (y - a[1]) / (b[1] - a[1]);
    width = Math.max(width, a[0] + (b[0] - a[0]) * t);
  }
  return width;
}

export const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const round2 = <T extends readonly number[]>(pair: T) => pair.map((value) => round(value, 3)) as unknown as T;
/** A box from `x0,y0,z0,x1,y1,z1`, or from the reference bounds when a flag is absent. */
export function boxFrom(values: number[] | undefined, fallback: Box): Box {
  if (!values) return fallback;
  return { min: [0, 1, 2].map((i) => Math.min(values[i], values[i + 3])) as Vec3, max: [0, 1, 2].map((i) => Math.max(values[i], values[i + 3])) as Vec3 };
}
export const referenceHeader = (meta: ReferenceMeta) => ({ reference: meta.name, source: meta.source, vehicleName: meta.vehicleName, frame: meta.frame.axes, bounds: meta.bounds });
