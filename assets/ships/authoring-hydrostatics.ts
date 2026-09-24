/** Hull-section hydrostatics for the author-* helpers (displacement, buoyancy
 * centre, initial metacentre). The runtime solver moved to the published
 * table (scripts/ships/hydrostaticTable.ts); authoring only needs this plain
 * clipping reference, so it lives with the authoring recipes. */
import type { Hull, Vec3 } from '../../src/ships/blueprint';
import { rotate } from '../../src/game/geometry';
import { hullSection } from '../../scripts/ships/hydrostaticTable';

type Point = [number, number];
interface Slice { z: number; dz: number; polygon: Point[] }
export interface Hydrostatics { volume: number; center: Vec3 }
const cache = new WeakMap<Hull, Slice[]>();

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

/** Displaced volume and buoyancy centre with the waterplane at `y`. */
export function hydrostatics(hull: Hull, y = 0, roll = 0, pitch = 0): Hydrostatics {
  const nx = Math.sin(roll) * Math.cos(pitch), ny = Math.cos(roll) * Math.cos(pitch), nz = -Math.sin(pitch);
  let volume = 0, x = 0, cy = 0, z = 0;
  for (const slice of slices(hull)) {
    const m = clippedMoment(slice.polygon, nx, ny, -y - nz * slice.z), v = m.area * slice.dz;
    volume += v; x += m.x * v; cy += m.y * v; z += slice.z * v;
  }
  return { volume, center: volume > 1e-9 ? [x / volume, cy / volume, z / volume] : [0, 0, 0] };
}

/** Immersion displacing `volume` at a fixed heel and trim, by bisection. */
export function flotation(hull: Hull, volume: number, roll = 0, pitch = 0): Hydrostatics & { y: number } {
  const bound = hull.length + hull.beam + hull.draft + hull.depth;
  let low = -bound, high = bound;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (hydrostatics(hull, mid, roll, pitch).volume > volume) low = mid; else high = mid;
  }
  const y = (low + high) / 2;
  return { ...hydrostatics(hull, y, roll, pitch), y };
}

/** Initial metacentre height above the waterline, from a small finite heel. */
export function initialMetacenter(hull: Hull): number {
  const base = hydrostatics(hull), angle = .002, f = flotation(hull, base.volume, angle);
  const b = rotate(f.center, { heading: 0, pitch: 0, roll: angle });
  return -b[0] / Math.sin(angle);
}
