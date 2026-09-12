import type { Hull, Vec3 } from '../ships/blueprint';
import { interpolate } from './hull';
import { rotate } from './geometry';

type Point = [number, number];
interface Slice { z: number; dz: number; polygon: Point[]; projections?: Float64Array; }
const cache = new WeakMap<Hull, Slice[]>();
// A previous immersion is only a search hint. Every volume query remains live,
// and the enclosing grid search still resolves the identical final interval.
const flotationStarts = new WeakMap<Hull, number>();
const fullMoments = new WeakMap<Hull, Hydrostatics>();
/** Same station loft as hullContains; station-only hulls retain their rectangular sections. */
export function hullSection(hull: Hull, station: number): Point[] {
  if (!hull.sections) {
    const w = interpolate(hull.halfBreadths, station), bottom = interpolate(hull.keelHeights, station), top = interpolate(hull.deckHeights, station);
    return [[-w, bottom], [w, bottom], [w, top], [-w, top]];
  }
  const ss = hull.sections, i = Math.max(1, ss.findIndex(s => s.station >= station));
  const a = ss[i - 1], b = ss[i], t = (station - a.station) / (b.station - a.station);
  let right: Point[];
  if (a.points.length === b.points.length) right = a.points.map(([x, y], j) => [x + (b.points[j][0] - x) * t, y + (b.points[j][1] - y) * t]);
  else {
    const low = a.points[0][1] * (1 - t) + b.points[0][1] * t, high = a.points.at(-1)![1] * (1 - t) + b.points.at(-1)![1] * t;
    right = Array.from({ length: 17 }, (_, j) => { const y = low + (high - low) * j / 16; return [interpolate(a.points.map(([x, y]) => [y, x]), y) * (1 - t) + interpolate(b.points.map(([x, y]) => [y, x]), y) * t, y]; });
  }
  return [...right.map(([x, y]): Point => [-x, y]).reverse(), ...right];
}
function slices(hull: Hull): Slice[] {
  let result = cache.get(hull);
  if (!result) {
    // Midpoint integration with station breaks keeps narrow end sections bounded.
    const stations = [...new Set([0, hull.length, ...hull.halfBreadths.map(p => p[0]), ...(hull.sections ?? []).map(s => s.station), ...Array.from({ length: 49 }, (_, i) => hull.length * i / 48)])].sort((a, b) => a - b);
    result = stations.slice(1).map((end, i) => ({ z: hull.length / 2 - (end + stations[i]) / 2, dz: end - stations[i], polygon: hullSection(hull, (end + stations[i]) / 2) }));
    cache.set(hull, result);
  }
  return result;
}
// Integrate the clipped edge stream directly. Repeated hydrostatic evaluations
// otherwise allocate a new polygon for every section at every trial immersion.
function clippedMoment(polygon: Point[], nx: number, ny: number, limit: number) {
  let area = 0, x = 0, y = 0, count = 0, firstX = 0, firstY = 0, lastX = 0, lastY = 0;
  const append = (px: number, py: number) => {
    if (count++ === 0) { firstX = px; firstY = py; }
    else {
      const cross = lastX * py - px * lastY;
      area += cross; x += (lastX + px) * cross; y += (lastY + py) * cross;
    }
    lastX = px; lastY = py;
  };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = nx * a[0] + ny * a[1] - limit, db = nx * b[0] + ny * b[1] - limit;
    if (da <= 0) append(a[0], a[1]);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); append(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); }
  }
  if (count) append(firstX, firstY);
  return Math.abs(area) < 1e-12 ? { area: 0, x: 0, y: 0 } : { area: Math.abs(area) / 2, x: x / (3 * area), y: y / (3 * area) };
}
export interface Hydrostatics { volume: number; center: Vec3; }
export function hydrostatics(hull: Hull, y = 0, roll = 0, pitch = 0): Hydrostatics {
  const table = tables.get(hull);
  return table ? tableSample(table, y, roll, pitch) : meshHydrostatics(hull, y, roll, pitch);
}
/** Clips every hull section at the given immersion. The published table is
 * built from and measured against this; it stays the reference, not the path
 * a battle takes. */
export function meshHydrostatics(hull: Hull, y = 0, roll = 0, pitch = 0): Hydrostatics {
  const nx = Math.sin(roll) * Math.cos(pitch), ny = Math.cos(roll) * Math.cos(pitch), nz = -Math.sin(pitch);
  let volume = 0, x = 0, cy = 0, z = 0;
  for (const slice of slices(hull)) {
    const m = clippedMoment(slice.polygon, nx, ny, -y - nz * slice.z), v = m.area * slice.dz;
    volume += v; x += m.x * v; cy += m.y * v; z += slice.z * v;
  }
  return { volume, center: volume > 1e-9 ? [x / volume, cy / volume, z / volume] : [0, 0, 0] };
}

/** Trial immersions need area only. Keep the clipped edge and addition order
 * identical to clippedMoment; calculate centroids at the final immersion. */
function clippedArea(polygon: Point[], projections: Float64Array, limit: number): number {
  let area = 0, count = 0, firstX = 0, firstY = 0, lastX = 0, lastY = 0;
  const append = (x: number, y: number) => {
    if (count++ === 0) { firstX = x; firstY = y; }
    else area += lastX * y - x * lastY;
    lastX = x; lastY = y;
  };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = projections[i] - limit, db = projections[(i + 1) % polygon.length] - limit;
    if (da <= 0) append(a[0], a[1]);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      append(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  }
  if (count) append(firstX, firstY);
  return Math.abs(area) < 1e-12 ? 0 : Math.abs(area) / 2;
}

export function flotation(hull: Hull, volume: number, roll = 0, pitch = 0): Hydrostatics & { y: number; afloat: boolean } {
  const table = tables.get(hull);
  return table ? tableFlotation(table, hull.length + hull.beam + hull.draft + hull.depth, volume, roll, pitch) : meshFlotation(hull, volume, roll, pitch);
}
/** Total displacement of the hull with every vertex submerged, the loss-of-
 * flotation threshold. The table publishes it directly so both simulations
 * compare against the same number rather than two roundings of it. */
export function hullVolume(hull: Hull): number {
  const table = tables.get(hull);
  return table ? table.fullVolume : meshHydrostatics(hull, -(hull.length + hull.beam + hull.draft + hull.depth)).volume;
}
/** Bisects the mesh solver for the immersion that displaces `volume`. */
export function meshFlotation(hull: Hull, volume: number, roll = 0, pitch = 0): Hydrostatics & { y: number; afloat: boolean } {
  const bound = hull.length + hull.beam + hull.draft + hull.depth;
  // At -bound every authored vertex is submerged at every orientation, so the
  // unclipped local moments depend only on the immutable hull geometry.
  let full = fullMoments.get(hull);
  if (!full) { full = meshHydrostatics(hull, -bound, roll, pitch); fullMoments.set(hull, full); }
  if (volume >= full.volume) return { volume: full.volume, center: [...full.center], y: -bound, afloat: false };
  const sections = slices(hull), nx = Math.sin(roll) * Math.cos(pitch), ny = Math.cos(roll) * Math.cos(pitch), nz = -Math.sin(pitch);
  // Every trial shares its orientation. Project each vertex once, retaining
  // the original multiplication/addition order and double precision.
  for (const slice of sections) {
    const projected = slice.projections ??= new Float64Array(slice.polygon.length);
    for (let i = 0; i < projected.length; i++) projected[i] = nx * slice.polygon[i][0] + ny * slice.polygon[i][1];
  }
  const volumeAt = (y: number): number => {
    let result = 0;
    for (const slice of sections) result += clippedArea(slice.polygon, slice.projections!, -y - nz * slice.z) * slice.dz;
    return result;
  };
  // Search the same 2^27 intervals as the original bisection, using secant
  // guesses to reach the waterline sooner. Reconstruct trial coordinates with
  // the original midpoint operations so rounding and the final pose match.
  const intervals = 2 ** 27;
  const coordinate = (index: number): number => {
    let low = -bound, high = bound, start = 0, end = intervals;
    if (index === start) return low;
    if (index === end) return high;
    while (true) {
      const mid = (start + end) / 2, y = (low + high) / 2;
      if (index === mid) return y;
      if (index < mid) { end = mid; high = y; } else { start = mid; low = y; }
    }
  };
  let low = 0, high = intervals;
  let previousIndex = low, previousVolume = full.volume, next = flotationStarts.get(hull) ?? intervals / 2;
  let iterations = 0;
  while (high - low > 1) {
    const index = Math.max(low + 1, Math.min(high - 1, Math.round(next)));
    const trial = volumeAt(coordinate(index));
    if (trial > volume) low = index; else high = index;
    const slope = (trial - previousVolume) / (index - previousIndex);
    const guess = index + (volume - trial) / slope;
    previousIndex = index; previousVolume = trial;
    next = ++iterations < 24 && Number.isFinite(guess) && guess > low && guess < high
      ? guess : (low + high) / 2;
  }
  const y = (coordinate(low) + coordinate(high)) / 2;
  flotationStarts.set(hull, low);
  return { ...meshHydrostatics(hull, y, roll, pitch), y, afloat: true };
}
export function rightingArms(centerBuoyancy: Vec3, centerGravity: Vec3, roll: number, pitch: number): { roll: number; pitch: number } {
  const pose = { roll, pitch, heading: 0 }, b = rotate(centerBuoyancy, pose), g = rotate(centerGravity, pose);
  return { roll: b[0] - g[0], pitch: g[2] - b[2] };
}
/** Initial metacenter measured from the finite-angle hull solution, for authoring a declared load. */
export function initialMetacenter(hull: Hull): number {
  const base = hydrostatics(hull), angle = .002, f = flotation(hull, base.volume, angle);
  const b = rotate(f.center, { heading: 0, pitch: 0, roll: angle });
  return -b[0] / Math.sin(angle);
}

/** Immersion, displacement and buoyancy centroid solved once per hull over a
 * heel x trim x displacement grid, so a battle interpolates instead of clipping
 * every hull section at every trial immersion. Published as content by
 * scripts/ships/hydrostatics.ts and read by both simulations, which therefore
 * cannot drift apart. */
export interface HydrostaticTable {
  version: 1;
  /** Heel from upright in radians, 0 to pi; sections are mirrored, so negative heel reflects. */
  heel: number[];
  /** Trim in radians, -pi/2 to pi/2. */
  trim: number[];
  /** Displacement intervals per orientation; each run holds steps + 1 nodes. */
  steps: number;
  fullVolume: number; fullCenter: Vec3;
  /** base64 little-endian f32 (immersion, displacement, centroid x, y, z) per
   * node, ordered heel-major, then trim, then displacement. */
  nodes: string;
}
/** Nodes hold (immersion, displacement, centroid) as little-endian f32. */
export const NODE_STRIDE = 5;
/** A compiled hull carries no table of its own: the blueprint compiler's output
 * is hashed into the baked model, so derived content is attached here instead. */
const tables = new WeakMap<Hull, HydrostaticTable>();
export function registerHydrostaticTable(hull: Hull, table: HydrostaticTable): void { tables.set(hull, table); }
const decoded = new WeakMap<HydrostaticTable, Float32Array>();
function nodes(table: HydrostaticTable): Float32Array {
  let result = decoded.get(table);
  if (!result) {
    const raw = atob(table.nodes), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    decoded.set(table, result = new Float32Array(bytes.buffer));
  }
  return result;
}
/** Cell containing `at`, clamped to the ends; grids are short, so a scan beats a search. */
function cell(grid: number[], at: number): [number, number] {
  const last = grid.length - 1;
  if (at <= grid[0]) return [0, 0];
  if (at >= grid[last]) return [last - 1, 1];
  let i = 0;
  while (i < last - 1 && grid[i + 1] < at) i++;
  return [i, (at - grid[i]) / (grid[i + 1] - grid[i])];
}
/** Cubic Hermite over cell [i, i+1] with central-difference slopes, spread over
 * the four contributing nodes. The buoyancy locus curves with a radius of the
 * metacentric height, hundreds of metres on a battleship, so a straight chord
 * between angles is far too coarse; the cubic follows the arc. */
function hermite(grid: number[], i: number, t: number, weight: number[]): number[] {
  const last = grid.length - 1, a = Math.max(0, i - 1), d = Math.min(last, i + 2), h = grid[i + 1] - grid[i];
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  weight[0] = 0; weight[1] = h00; weight[2] = h01; weight[3] = 0;
  if (a === i) { weight[1] -= h10; weight[2] += h10; }
  else { const k = h10 * h / (grid[i + 1] - grid[a]); weight[0] -= k; weight[2] += k; }
  if (d === i + 1) { weight[1] -= h11; weight[2] += h11; }
  else { const k = h11 * h / (grid[d] - grid[i]); weight[1] -= k; weight[3] += k; }
  return [a, i, i + 1, d];
}
/** Interpolate one orientation's node run at a displacement. */
function atVolume(n: Float32Array, base: number, steps: number, volume: number, out: number[]): void {
  let k = 0;
  while (k < steps - 1 && n[base + (k + 1) * NODE_STRIDE + 1] < volume) k++;
  const a = base + k * NODE_STRIDE, b = a + NODE_STRIDE, low = n[a + 1], high = n[b + 1];
  const t = high > low ? (volume - low) / (high - low) : 0;
  out[0] = n[a] + (n[b] - n[a]) * t;
  for (let i = 1; i < 4; i++) out[i] = n[a + 1 + i] + (n[b + 1 + i] - n[a + 1 + i]) * t;
}
/** Interpolate one orientation's node run at an immersion; y falls as k rises. */
function atImmersion(n: Float32Array, base: number, steps: number, y: number, out: number[]): void {
  let k = 0;
  while (k < steps - 1 && n[base + (k + 1) * NODE_STRIDE] > y) k++;
  const a = base + k * NODE_STRIDE, b = a + NODE_STRIDE, high = n[a], low = n[b];
  const t = Math.min(1, Math.max(0, high > low ? (high - y) / (high - low) : 0));
  for (let i = 0; i < 4; i++) out[i] = n[a + 1 + i] + (n[b + 1 + i] - n[a + 1 + i]) * t;
}
const heelWeight = [0, 0, 0, 0], trimWeight = [0, 0, 0, 0], corner = [0, 0, 0, 0];
function interpolated(table: HydrostaticTable, roll: number, pitch: number, at: (base: number, out: number[]) => void): number[] {
  const [h, ht] = cell(table.heel, Math.abs(roll)), [t, tt] = cell(table.trim, pitch);
  const heels = hermite(table.heel, h, ht, heelWeight), trims = hermite(table.trim, t, tt, trimWeight);
  const run = (table.steps + 1) * NODE_STRIDE, n = nodes(table), total = [0, 0, 0, 0];
  for (let a = 0; a < 4; a++) {
    if (heelWeight[a] === 0) continue;
    for (let b = 0; b < 4; b++) {
      if (trimWeight[b] === 0) continue;
      const w = heelWeight[a] * trimWeight[b];
      at((heels[a] * table.trim.length + trims[b]) * run, corner);
      for (let i = 0; i < 4; i++) total[i] += corner[i] * w;
    }
  }
  return total;
}
/** Hull sections are mirrored about the centreline, so a heeled table entry
 * serves both sides with the transverse centroid reflected. */
export function tableSample(table: HydrostaticTable, y: number, roll: number, pitch: number): Hydrostatics {
  const n = nodes(table);
  const total = interpolated(table, roll, pitch, (base, out) => atImmersion(n, base, table.steps, y, out));
  return { volume: total[0], center: total[0] > 1e-9 ? [(roll < 0 ? -1 : 1) * total[1], total[2], total[3]] : [0, 0, 0] };
}
export function tableFlotation(table: HydrostaticTable, bound: number, volume: number, roll: number, pitch: number): Hydrostatics & { y: number; afloat: boolean } {
  if (volume >= table.fullVolume) return { volume: table.fullVolume, center: [...table.fullCenter], y: -bound, afloat: false };
  const n = nodes(table);
  const total = interpolated(table, roll, pitch, (base, out) => atVolume(n, base, table.steps, volume, out));
  return { volume, center: [(roll < 0 ? -1 : 1) * total[1], total[2], total[3]], y: total[0], afloat: true };
}
