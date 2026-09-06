import type { Hull, Vec3 } from '../ships/blueprint';
import { hullSection } from './hydrostatics';
import { add, dot, normalize, scale, segmentOverlapsBox, sub } from './geometry';
interface Triangle { a: Vec3; b: Vec3; c: Vec3; index: number; center: Vec3; size: Vec3; }
interface Node { center: Vec3; size: Vec3; triangles?: Triangle[]; children?: Node[]; }
const cache = new WeakMap<Hull, Node>();
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function bounds(points: Vec3[]): { center: Vec3; size: Vec3 } {
  const lo = [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))), hi = [0, 1, 2].map(i => Math.max(...points.map(p => p[i])));
  return { center: lo.map((n, i) => (n + hi[i]) / 2) as Vec3, size: lo.map((n, i) => Math.max(.00001, hi[i] - n)) as Vec3 };
}
function tree(ts: Triangle[]): Node {
  const box = bounds(ts.flatMap(t => [t.a, t.b, t.c]));
  if (ts.length <= 12) return { ...box, triangles: ts };
  const axis = box.size.indexOf(Math.max(...box.size)); ts.sort((a, b) => a.center[axis] - b.center[axis]); const mid = ts.length >> 1;
  return { ...box, children: [tree(ts.slice(0, mid)), tree(ts.slice(mid))] };
}
function mesh(hull: Hull): Node {
  let node = cache.get(hull); if (node) return node;
  const stations = [...new Set([0, hull.length, ...hull.halfBreadths.map(p => p[0]), ...(hull.sections ?? []).map(s => s.station)])].sort((a, b) => a - b);
  const triangles: Triangle[] = [];
  const triangle = (a: Vec3, b: Vec3, c: Vec3) => { if (Math.hypot(...cross(sub(b, a), sub(c, a))) > 1e-9) triangles.push({ a, b, c, index: triangles.length, ...bounds([a, b, c]) }); };
  const edge = (station: number) => {
    const polygon = hullSection(hull, station), low = Math.min(...polygon.map(p => p[1])), high = Math.max(...polygon.map(p => p[1]));
    return { low, high, polygon, fractions: polygon.map(p => (p[1] - low) / (high - low || 1)) };
  };
  const point = (s: ReturnType<typeof edge>, station: number, f: number, sign: number): Vec3 => {
    const y = s.low + (s.high - s.low) * f; let width = 0;
    for (let i = 0; i < s.polygon.length; i++) { const a = s.polygon[i], b = s.polygon[(i + 1) % s.polygon.length]; if (y < Math.min(a[1], b[1]) - 1e-7 || y > Math.max(a[1], b[1]) + 1e-7) continue;
      const x = Math.abs(b[1] - a[1]) < 1e-9 ? Math.max(a[0], b[0]) : a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]); width = Math.max(width, x); }
    return [sign * width, y, hull.length / 2 - station];
  };
  for (let i = 1; i < stations.length; i++) {
    const az = stations[i - 1], bz = stations[i], a = edge(az), b = edge(bz), fs = [...new Set([0, 1, ...a.fractions, ...b.fractions])].sort((a, b) => a - b);
    for (const sign of [-1, 1]) for (let j = 1; j < fs.length; j++) { const p = point(a, az, fs[j - 1], sign), q = point(a, az, fs[j], sign), r = point(b, bz, fs[j], sign), s = point(b, bz, fs[j - 1], sign); triangle(p, q, r); triangle(p, r, s); }
    for (const f of [0, 1]) { const p = point(a, az, f, -1), q = point(a, az, f, 1), r = point(b, bz, f, 1), s = point(b, bz, f, -1); triangle(p, q, r); triangle(p, r, s); }
  }
  for (const station of [0, hull.length]) { const polygon = hullSection(hull, station).map(([x, y]): Vec3 => [x, y, hull.length / 2 - station]); for (let i = 1; i < polygon.length - 1; i++) triangle(polygon[0], polygon[i], polygon[i + 1]); }
  node = tree(triangles); cache.set(hull, node); return node;
}
/** Cached hull-shell BVH covers deck, bottom and ends between authored plates. */
export function hullContacts(hull: Hull, from: Vec3, to: Vec3): { t: number; point: Vec3; normal: Vec3; index: number }[] {
  const result: ReturnType<typeof hullContacts> = [], direction = sub(to, from);
  const visit = (node: Node) => {
    if (!segmentOverlapsBox(from, to, node)) return;
    if (node.children) { node.children.forEach(visit); return; }
    for (const tri of node.triangles!) {
      const e1 = sub(tri.b, tri.a), e2 = sub(tri.c, tri.a), p = cross(direction, e2), det = dot(e1, p);
      if (Math.abs(det) < 1e-9) continue;
      const offset = sub(from, tri.a), u = dot(offset, p) / det; if (u < -1e-7 || u > 1 + 1e-7) continue;
      const q = cross(offset, e1), v = dot(direction, q) / det; if (v < -1e-7 || u + v > 1 + 1e-7) continue;
      const t = dot(e2, q) / det; if (t < -1e-8 || t > 1 + 1e-8) continue;
      result.push({ t: Math.max(0, t), point: add(from, scale(direction, Math.max(0, t))), normal: normalize(cross(e1, e2)), index: tri.index });
    }
  };
  visit(mesh(hull)); return result.sort((a, b) => a.t - b.t);
}
