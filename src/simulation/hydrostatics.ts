import type { Hull, Vec3 } from '../ships/blueprint';
import { interpolate } from './hull';
import { rotate } from './geometry';

type Point = [number, number];
interface Slice { z: number; dz: number; polygon: Point[]; }
const cache = new WeakMap<Hull, Slice[]>();
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
// Integrate the clipped edge stream directly. A flotation solve evaluates every
// section 29 times; allocating a new polygon at each trial dominated flood spikes.
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
  const nx = Math.sin(roll) * Math.cos(pitch), ny = Math.cos(roll) * Math.cos(pitch), nz = -Math.sin(pitch);
  let volume = 0, x = 0, cy = 0, z = 0;
  for (const slice of slices(hull)) {
    const m = clippedMoment(slice.polygon, nx, ny, -y - nz * slice.z), v = m.area * slice.dz;
    volume += v; x += m.x * v; cy += m.y * v; z += slice.z * v;
  }
  return { volume, center: volume > 1e-9 ? [x / volume, cy / volume, z / volume] : [0, 0, 0] };
}
export function flotation(hull: Hull, volume: number, roll = 0, pitch = 0): Hydrostatics & { y: number; afloat: boolean } {
  const bound = hull.length + hull.beam + hull.draft + hull.depth;
  const full = hydrostatics(hull, -bound, roll, pitch);
  if (volume >= full.volume) return { ...full, y: -bound, afloat: false };
  let low = -bound, high = bound;
  for (let i = 0; i < 27; i++) { const y = (low + high) / 2; if (hydrostatics(hull, y, roll, pitch).volume > volume) low = y; else high = y; }
  const y = (low + high) / 2;
  return { ...hydrostatics(hull, y, roll, pitch), y, afloat: true };
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
