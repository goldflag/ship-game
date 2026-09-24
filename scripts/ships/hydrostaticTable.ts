/** Builds the per-class hydrostatic lookup the ship pipeline publishes with the
 * fleet. Clipping every hull section at 27 trial immersions cost
 * about a million vertex clips per ship per half second; the table replaces that
 * with a bicubic interpolation of pre-solved displacements. The mesh solver in
 * hydrostatics.ts stays the reference the table is measured against. */
import type { Hull, Vec3 } from '../../src/ships/blueprint';
import { interpolate } from '../../src/ships/hull';
import { rotate } from '../../src/game/geometry';

type Point = [number, number];
interface Slice { z: number; dz: number; polygon: Point[]; projections?: Float64Array; }
const cache = new WeakMap<Hull, Slice[]>();
// A previous immersion is only a search hint. Every volume query remains live,
// and the enclosing grid search still resolves the identical final interval.

export function hullSection(hull: Hull, station: number): Point[] {
  if (!hull.sections) {
    const w = interpolate(hull.halfBreadths, station), bottom = interpolate(hull.keelHeights, station), top = interpolate(hull.deckHeights, station);
    return [[-w, bottom], [w, bottom], [w, top], [-w, top]];
  }
  const ss = hull.sections, i = Math.max(1, ss.findIndex(s => s.station >= station));
  const a = ss[i - 1], b = ss[i], t = (station - a.station) / (b.station - a.station);
  const right: Point[] = a.points.map(([x, y], j) => [x + (b.points[j][0] - x) * t, y + (b.points[j][1] - y) * t]);
  return [...right.map(([x, y]): Point => [-x, y]).reverse(), ...right];
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

const degrees = (n: number) => n * Math.PI / 180;
/** Angles thicken towards upright, where the buoyancy locus curves hardest. */
function ladder(first: number, ratio: number, last: number): number[] {
  const out = [0];
  for (let a = first; a < last; a *= ratio) out.push(a);
  out.push(last);
  return out;
}
/** Heel is measured from upright: hull sections are mirrored, so negative heel
 * is the reflected table entry. Trim has no such symmetry. */
export const HEEL_ANGLES = [...ladder(3, 1.5, 90), 105, 120, 140, 160, 180].map(degrees);
export const TRIM_ANGLES = (() => { const l = ladder(.8, 1.5, 90); return [...l.slice(1).reverse().map(n => -n), ...l].map(degrees); })();
export const VOLUME_STEPS = 32;
/** Displacement fraction of each node, shared by every orientation so that their
 * interpolation errors run together and cancel between tabulated angles. Nodes
 * thicken at both ends, where a metre of draft buys the least volume, and around
 * the deck edge going under, where a metre of draft suddenly buys much less than
 * it did: cosine spacing for four fifths of the nodes, and a fifth spread normally
 * about 87% of the hull's volume (sigma 8%), where every catalog hull's worst draft
 * error sat with cosine spacing alone. Written out, so the distribution is a fixed
 * choice rather than something recomputed through libm. Tables solved on different
 * platforms still differ in the last float32 bit, since sin and cos round
 * differently there. */
const FRACTIONS = [
  0, 0.00376, 0.014984, 0.033504, 0.059039, 0.091208, 0.129524, 0.173414, 0.222215, 0.275194, 0.331555,
  0.390449, 0.450991, 0.512269, 0.573323, 0.632753, 0.68708, 0.731339, 0.765266, 0.792135, 0.814707, 0.83468,
  0.85309, 0.870617, 0.887739, 0.904806, 0.922039, 0.939469, 0.95678, 0.973102, 0.986945, 0.996482, 1,
];
if (FRACTIONS.length !== VOLUME_STEPS + 1) throw new Error('One displacement fraction per node');
const fraction = (k: number) => FRACTIONS[k];

interface Sections { vx: Float64Array; vy: Float64Array; start: Int32Array; dz: Float64Array; z: Float64Array; count: number }
/** The same station loft as the mesh solver, flattened for repeated clipping. */
function sections(hull: Hull): Sections {
  const stations = [...new Set([0, hull.length, ...hull.halfBreadths.map(p => p[0]), ...(hull.sections ?? []).map(s => s.station), ...Array.from({ length: 49 }, (_, i) => hull.length * i / 48)])].sort((a, b) => a - b);
  const polygons = stations.slice(1).map((end, i) => ({ z: hull.length / 2 - (end + stations[i]) / 2, dz: end - stations[i], points: hullSection(hull, (end + stations[i]) / 2) }));
  const vx = new Float64Array(polygons.reduce((n, p) => n + p.points.length, 0)), vy = new Float64Array(vx.length);
  const start = new Int32Array(polygons.length + 1), dz = new Float64Array(polygons.length), z = new Float64Array(polygons.length);
  let at = 0;
  polygons.forEach((p, i) => { start[i] = at; dz[i] = p.dz; z[i] = p.z; for (const [x, y] of p.points) { vx[at] = x; vy[at] = y; at++; } });
  start[polygons.length] = at;
  return { vx, vy, start, dz, z, count: polygons.length };
}

/** Immersed volume and, when asked, its centroid, at one immersion. */
function immersion(s: Sections, projections: Float64Array, nz: number, y: number, moments: boolean) {
  let volume = 0, mx = 0, my = 0, mz = 0;
  for (let i = 0; i < s.count; i++) {
    const from = s.start[i], to = s.start[i + 1], limit = -y - nz * s.z[i];
    let area = 0, cx = 0, cy = 0, count = 0, fx = 0, fy = 0, lx = 0, ly = 0;
    for (let a = from; a < to; a++) {
      const b = a + 1 === to ? from : a + 1, da = projections[a] - limit, db = projections[b] - limit;
      if (da <= 0) {
        const px = s.vx[a], py = s.vy[a];
        if (count++ === 0) { fx = px; fy = py; } else { const c = lx * py - px * ly; area += c; if (moments) { cx += (lx + px) * c; cy += (ly + py) * c; } }
        lx = px; ly = py;
      }
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db), px = s.vx[a] + (s.vx[b] - s.vx[a]) * t, py = s.vy[a] + (s.vy[b] - s.vy[a]) * t;
        if (count++ === 0) { fx = px; fy = py; } else { const c = lx * py - px * ly; area += c; if (moments) { cx += (lx + px) * c; cy += (ly + py) * c; } }
        lx = px; ly = py;
      }
    }
    if (count) { const c = lx * fy - fx * ly; area += c; if (moments) { cx += (lx + fx) * c; cy += (ly + fy) * c; } }
    if (Math.abs(area) < 1e-12) continue;
    const v = Math.abs(area) / 2 * s.dz[i];
    volume += v;
    if (moments) { mx += cx / (3 * area) * v; my += cy / (3 * area) * v; mz += s.z[i] * v; }
  }
  return { volume, center: (volume > 1e-9 ? [mx / volume, my / volume, mz / volume] : [0, 0, 0]) as Vec3 };
}

/** Little-endian f32; every supported host is little-endian and Rust reads the
 * same bytes back with from_le_bytes. */
function encode(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function buildHydrostaticTable(hull: Hull): HydrostaticTable {
  const s = sections(hull), bound = hull.length + hull.beam + hull.draft + hull.depth;
  const flat = new Float64Array(s.vx.length);
  for (let i = 0; i < flat.length; i++) flat[i] = s.vy[i];
  const full = immersion(s, flat, 0, -bound, true);
  const nodes = new Float32Array(HEEL_ANGLES.length * TRIM_ANGLES.length * (VOLUME_STEPS + 1) * NODE_STRIDE);
  const projections = new Float64Array(s.vx.length), scan = new Float64Array(65);
  for (let h = 0; h < HEEL_ANGLES.length; h++) for (let t = 0; t < TRIM_ANGLES.length; t++) {
    const roll = HEEL_ANGLES[h], pitch = TRIM_ANGLES[t];
    const nx = Math.sin(roll) * Math.cos(pitch), ny = Math.cos(roll) * Math.cos(pitch), nz = -Math.sin(pitch);
    let dry = -Infinity, wet = Infinity;
    for (let i = 0; i < s.count; i++) for (let a = s.start[i]; a < s.start[i + 1]; a++) {
      projections[a] = nx * s.vx[a] + ny * s.vy[a];
      const y = -(projections[a] + nz * s.z[i]);
      if (y < wet) wet = y;
      if (y > dry) dry = y;
    }
    // A coarse draft sweep places the nodes by displacement; each node then
    // records the displacement actually measured there, so placement is a
    // distribution choice and never an error.
    for (let i = 0; i < scan.length; i++) scan[i] = immersion(s, projections, nz, dry + (wet - dry) * i / (scan.length - 1), false).volume;
    const base = (h * TRIM_ANGLES.length + t) * (VOLUME_STEPS + 1) * NODE_STRIDE;
    let cursor = 0;
    for (let k = 0; k <= VOLUME_STEPS; k++) {
      let y = k === 0 ? dry : wet;
      if (k > 0 && k < VOLUME_STEPS) {
        const target = full.volume * fraction(k);
        while (cursor < scan.length - 2 && scan[cursor + 1] < target) cursor++;
        const a = scan[cursor], b = scan[cursor + 1];
        y = dry + (wet - dry) * (cursor + (b > a ? (target - a) / (b - a) : 0)) / (scan.length - 1);
      }
      const at = k === VOLUME_STEPS ? full : immersion(s, projections, nz, y, true);
      const node = base + k * NODE_STRIDE;
      nodes[node] = y; nodes[node + 1] = at.volume;
      for (let i = 0; i < 3; i++) nodes[node + 2 + i] = at.center[i];
    }
    // The dry node displaces nothing, so it has no centroid; hold the next one's
    // rather than publish an origin that would drag the interpolation.
    for (let i = 2; i < NODE_STRIDE; i++) nodes[base + i] = nodes[base + NODE_STRIDE + i];
  }
  return {
    version: 1, heel: HEEL_ANGLES, trim: TRIM_ANGLES, steps: VOLUME_STEPS,
    fullVolume: full.volume, fullCenter: full.center, nodes: encode(nodes),
  };
}
